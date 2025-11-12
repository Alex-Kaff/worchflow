import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import type { Db, Collection } from 'mongodb';
import type { EventSchemaShape } from '../types';
import type {
  SchedulerConfig,
  CronExecutionRecord,
  ScheduledFunctionInfo,
  ScheduleTriggeredEvent,
  ScheduleRegisteredEvent,
  ScheduleMissedEvent,
  AnyWorkchflowFunction,
  InputWorkchflowFunction,
} from '../types/scheduler';
import { WorchflowClient } from '../client/WorchflowClient';
import { validateCronExpression, getNextCronRun, shouldHaveRun } from '../utils/cron';

export class WorchflowScheduler<TEvents extends EventSchemaShape = EventSchemaShape> extends EventEmitter {
  private config: SchedulerConfig<TEvents>;
  private functions: AnyWorkchflowFunction<TEvents>[];
  private client: WorchflowClient<TEvents>;
  private cronJobs: Map<string, CronJob> = new Map();
  private queuePrefix: string;
  private leaderKey: string;
  private leaderInterval?: NodeJS.Timeout;
  private isLeader: boolean = false;
  private isRunning: boolean = false;
  private leaderElectionEnabled: boolean;
  private leaderTTL: number;
  private leaderCheckInterval: number;
  private db: Db;
  private cronExecutionsCollection: Collection<CronExecutionRecord>;

  constructor(
    config: SchedulerConfig<TEvents>,
    functions: InputWorkchflowFunction<TEvents>[]
  ) {
    super();
    this.config = config;
    this.db = config.db;
    this.queuePrefix = config.queuePrefix || 'worchflow';
    this.leaderKey = `${this.queuePrefix}:scheduler:leader`;
    this.leaderElectionEnabled = config.leaderElection ?? true;
    this.leaderTTL = config.leaderTTL ?? 60;
    this.leaderCheckInterval = config.leaderCheckInterval ?? 30000;
    this.cronExecutionsCollection = this.db.collection<CronExecutionRecord>('cron_executions');

    const cronFunctions = functions.filter((fn): fn is AnyWorkchflowFunction<TEvents> => {
      return fn.cron !== undefined;
    });

    if (cronFunctions.length === 0) {
      throw new Error('No functions with cron schedules provided to scheduler');
    }

    for (const fn of cronFunctions) {
      if (!validateCronExpression(fn.cron)) {
        throw new Error(`Invalid cron expression "${fn.cron}" for function "${this.getFunctionId(fn)}"`);
      }
    }

    this.functions = cronFunctions;
    this.client = new WorchflowClient<TEvents>(config);
    
    this.log(`Scheduler initialized with ${this.functions.length} cron function(s)`);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Scheduler is already running');
    }

    this.isRunning = true;
    this.log('Starting scheduler...');

    await this.setupIndexes();
    await this.waitForClientReady();

    if (this.leaderElectionEnabled) {
      this.log('Leader election enabled');
      await this.tryAcquireLeadership();
      this.leaderInterval = setInterval(() => {
        this.tryAcquireLeadership();
      }, this.leaderCheckInterval);
    } else {
      this.log('Leader election disabled, starting as leader');
      this.isLeader = true;
      await this.startCronJobs();
    }

    this.emit('ready');
  }

  private async setupIndexes(): Promise<void> {
    try {
      await this.cronExecutionsCollection.createIndex(
        { functionId: 1 },
        { unique: true }
      );
      this.log('✓ Created index: cron_executions.functionId (unique)');
    } catch (error) {
      if (this.config.logging) {
        console.error('[Scheduler] Error setting up indexes:', error);
      }
    }
  }

  private async tryAcquireLeadership(): Promise<void> {
    try {
      if (this.isLeader) {
        const ttl = await this.config.redis.ttl(this.leaderKey);
        
        if (ttl > 0) {
          await this.config.redis.expire(this.leaderKey, this.leaderTTL);
        } else {
          this.isLeader = false;
          this.log('Lost leadership');
          this.stopCronJobs();
          this.emit('leader:lost');
        }
      } else {
        const result = await this.config.redis.set(
          this.leaderKey,
          'locked',
          'EX',
          this.leaderTTL,
          'NX'
        );

        if (result === 'OK') {
          this.isLeader = true;
          this.log('Acquired leadership');
          await this.startCronJobs();
          this.emit('leader:acquired');
        }
      }
    } catch (error) {
      this.log(`Error during leader election: ${this.getErrorMessage(error)}`);
      this.emit('error', error);
    }
  }

  private async startCronJobs(): Promise<void> {
    if (this.cronJobs.size > 0) {
      return;
    }

    this.log('Starting cron jobs...');
    
    for (const fn of this.functions) {
      const cronExpression = fn.cron;
      
      try {
        const job = new CronJob(cronExpression, async () => {
          await this.triggerScheduledExecution(fn);
        });

        const functionId = this.getFunctionId(fn);
        this.cronJobs.set(functionId, job);
        job.start();

        const nextRun = getNextCronRun(cronExpression);
        this.log(`Scheduled "${functionId}" with cron "${cronExpression}" (next: ${nextRun.toISOString()})`);
        
        const registeredEvent: ScheduleRegisteredEvent = { 
          functionId, 
          cron: cronExpression,
          nextRun 
        };
        this.emit('schedule:registered', registeredEvent);
      } catch (error) {
        this.log(`Failed to start cron job for "${this.getFunctionId(fn)}": ${this.getErrorMessage(error)}`);
        this.emit('error', error);
      }
    }

    this.log(`Started ${this.cronJobs.size} cron job(s)`);
    
    this.checkAndRunMissedExecutions().catch((error) => {
      this.log(`Error checking missed executions: ${this.getErrorMessage(error)}`);
    });
  }

  private async checkAndRunMissedExecutions(): Promise<void> {
    this.log('Checking for missed executions...');
    const now = new Date();
    let missedCount = 0;
    
    for (const fn of this.functions) {
      try {
        const functionId = this.getFunctionId(fn);
        const cronExpression = fn.cron;
        
        const record = await this.cronExecutionsCollection.findOne({ functionId });
        
        if (record) {
          const lastRun = record.lastExecutionTime;
          
          if (!lastRun || !(lastRun instanceof Date)) {
            this.log(`Invalid last run time for "${functionId}", skipping missed execution check`);
            continue;
          }
          
          const timeSinceLastRun = now.getTime() - lastRun.getTime();
          const timeSinceSeconds = Math.floor(timeSinceLastRun / 1000);
          
          this.log(`Checking "${functionId}": last run ${lastRun.toISOString()}, ${timeSinceSeconds}s ago`);
          
          const missed = shouldHaveRun(cronExpression, lastRun, now, this.config.logging ?? false);
          
          if (missed) {
            this.log(`Missed execution detected for "${functionId}" (last run: ${lastRun.toISOString()}, ${timeSinceSeconds}s ago), running immediately`);
            await this.triggerScheduledExecution(fn, true);
            missedCount++;
            
            const missedEvent: ScheduleMissedEvent = {
              functionId,
              lastExecutionTime: lastRun,
              triggeredAt: now,
            };
            this.emit('schedule:missed', missedEvent);
          } else {
            this.log(`No missed executions for "${functionId}" (last run: ${lastRun.toISOString()}, ${timeSinceSeconds}s ago)`);
          }
        } else {
          this.log(`First time scheduling "${functionId}"`);
        }
      } catch (error) {
        this.log(`Error checking missed executions for "${this.getFunctionId(fn)}": ${this.getErrorMessage(error)}`);
      }
    }
    
    if (missedCount > 0) {
      this.log(`Triggered ${missedCount} missed execution(s)`);
    } else {
      this.log('No missed executions found');
    }
  }

  private async triggerScheduledExecution(fn: AnyWorkchflowFunction<TEvents>, isMissed: boolean = false): Promise<void> {
    const functionId = this.getFunctionId(fn);
    const now = new Date();
    
    try {
      this.log(`Triggering ${isMissed ? 'missed ' : ''}scheduled execution for "${functionId}"`);
      
      const executionId = await this.client.send({
        name: fn.id,
        data: {},
      });

      await this.recordExecution(functionId, fn.cron, now);

      const triggeredEvent: ScheduleTriggeredEvent = {
        functionId,
        executionId,
        timestamp: now.getTime(),
        isMissed,
      };
      this.emit('schedule:triggered', triggeredEvent);

      this.log(`Scheduled execution created: ${executionId}`);
    } catch (error) {
      this.log(`Failed to trigger scheduled execution for "${functionId}": ${this.getErrorMessage(error)}`);
      this.emit('error', error);
    }
  }

  private async recordExecution(functionId: string, cronExpression: string, executionTime: Date): Promise<void> {
    try {
      const nextScheduledTime = getNextCronRun(cronExpression);
      
      await this.cronExecutionsCollection.updateOne(
        { functionId },
        {
          $set: {
            functionId,
            lastExecutionTime: executionTime,
            nextScheduledTime,
            cronExpression,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
    } catch (error) {
      this.log(`Error recording execution for "${functionId}": ${this.getErrorMessage(error)}`);
    }
  }

  private stopCronJobs(): void {
    if (this.cronJobs.size === 0) {
      return;
    }

    this.log('Stopping cron jobs...');
    
    for (const [functionId, job] of this.cronJobs.entries()) {
      job.stop();
      this.log(`Stopped cron job for "${functionId}"`);
    }
    
    this.cronJobs.clear();
    this.log('All cron jobs stopped');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.log('Stopping scheduler...');
    this.isRunning = false;

    if (this.leaderInterval) {
      clearInterval(this.leaderInterval);
      this.leaderInterval = undefined;
    }

    this.stopCronJobs();

    if (this.isLeader && this.leaderElectionEnabled) {
      try {
        await this.config.redis.del(this.leaderKey);
        this.log('Released leadership lock');
      } catch (error) {
        this.log(`Error releasing leadership lock: ${this.getErrorMessage(error)}`);
      }
    }

    this.isLeader = false;

    this.log('Scheduler stopped');
    this.emit('stopped');
  }

  getScheduledFunctions(): ScheduledFunctionInfo[] {
    return this.functions.map(fn => ({
      id: this.getFunctionId(fn),
      cron: fn.cron,
      nextRun: getNextCronRun(fn.cron),
    }));
  }

  isLeaderNode(): boolean {
    return this.isLeader;
  }

  private async waitForClientReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.client.getIsReady()) {
        this.log('Client already ready');
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Scheduler client initialization timeout after 30s'));
      }, 30000);
      
      this.client.once('ready', () => {
        clearTimeout(timeout);
        this.log('Client ready');
        resolve();
      });
      
      this.client.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private getFunctionId(fn: AnyWorkchflowFunction<TEvents>): string {
    return String(fn.id);
  }

  private log(message: string): void {
    if (this.config.logging) {
      console.log(`[Scheduler] ${message}`);
    }
  }
}

