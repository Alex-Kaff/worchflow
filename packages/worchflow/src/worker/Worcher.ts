import { EventEmitter } from 'events';
import type { WorcherConfig, WorkchflowFunction } from '../types';
import { Step } from '../execution/Step';

export class Worcher extends EventEmitter {
  private config: WorcherConfig;
  private functionMap: Map<string, WorkchflowFunction<any, any>>;
  private isReady: boolean = false;
  private isRunning: boolean = false;
  private queuePrefix: string;
  private queueName: string;
  private concurrency: number;
  private activeExecutions: number = 0;
  private logging: boolean;

  constructor(config: WorcherConfig, functions: WorkchflowFunction<any, any>[] = []) {
    super();
    this.config = config;
    this.queuePrefix = config.queuePrefix || 'worchflow';
    this.queueName = `${this.queuePrefix}:queue`;
    this.concurrency = config.concurrency || 1;
    this.logging = config.logging ?? false;
    this.functionMap = new Map(
      functions.map((fn) => [fn.id, fn])
    );
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await Promise.all([
        this.config.redis.ping(),
        this.config.db.admin().ping(),
      ]);

      this.isReady = true;
      this.emit('ready');
    } catch (error) {
      this.emit('error', error);
    }
  }

  async start(): Promise<void> {
    if (!this.isReady) {
      throw new Error('Worcher not ready. Wait for "ready" event.');
    }
    if (this.isRunning) {
      throw new Error('Worcher already running.');
    }
    this.isRunning = true;

    // Spawn N concurrent workers to process queue
    const workers = Array.from({ length: this.concurrency }, () => this.processQueue());
    await Promise.all(workers);
  }

  private async processQueue(): Promise<void> {
    while (this.isRunning) {
      try {
        // BLPOP is atomic - only one worker gets each executionId
        const result = await this.config.redis.blpop(this.queueName, 5);

        if (!result) {
          continue;
        }

        const [, executionId] = result;
        this.activeExecutions++;

        // Process execution without blocking queue polling
        this.processExecution(executionId).finally(() => {
          this.activeExecutions--;
        });
      } catch (error) {
        this.emit('error', error);
      }
    }
  }

  private async processExecution(executionId: string): Promise<void> {
    try {
      // Load execution metadata from Redis
      const executionData = await this.config.redis.hgetall(
        `${this.queuePrefix}:execution:${executionId}`
      );

      if (!executionData || !executionData.eventName) {
        throw new Error(`Execution ${executionId} not found in Redis`);
      }

      const eventName = executionData.eventName;
      const eventData = JSON.parse(executionData.eventData);

      const workflowFunction = this.functionMap.get(eventName);
      if (!workflowFunction) {
        throw new Error(`No function registered for event: ${eventName}`);
      }

      if (this.logging) {
        console.log(`[Worcher] Started: ${eventName} (${executionId.slice(0, 8)}...)`);
      }

      this.emit('execution:start', { executionId, eventName });

      // Create dedicated Redis connection for this execution's steps
      // This prevents BLPOP from blocking step operations
      const Redis = require('ioredis');
      const stepRedis = new Redis(this.config.redis.options);

      const step = new Step(
        executionId,
        stepRedis,
        this.config.db,
        this.queuePrefix
      );

      const context = {
        event: {
          name: eventName,
          data: eventData,
          id: executionId,
          timestamp: Number(executionData.createdAt),
        },
        step,
      };

      const result = await workflowFunction.execute(context);

      // Close the dedicated connection
      stepRedis.disconnect();

      // Mark execution as completed in Redis and MongoDB
      await Promise.all([
        this.config.redis.hset(
          `${this.queuePrefix}:execution:${executionId}`,
          'status',
          'completed',
          'result',
          JSON.stringify(result),
          'updatedAt',
          String(Date.now())
        ),
        this.config.db.collection('executions').updateOne(
          { id: executionId },
          {
            $set: {
              status: 'completed',
              result,
              updatedAt: Date.now(),
            },
          }
        ),
      ]);

      if (this.logging) {
        console.log(`[Worcher] Completed: ${eventName} (${executionId.slice(0, 8)}...)`);
      }

      this.emit('execution:complete', { executionId, result });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      if (this.logging) {
        console.error(`[Worcher] Failed: ${executionId.slice(0, 8)}... - ${errorMessage}`);
      }

      // Mark execution as failed in Redis and MongoDB
      await Promise.all([
        this.config.redis.hset(
          `${this.queuePrefix}:execution:${executionId}`,
          'status',
          'failed',
          'error',
          errorMessage,
          'updatedAt',
          String(Date.now())
        ),
        this.config.db.collection('executions').updateOne(
          { id: executionId },
          {
            $set: {
              status: 'failed',
              error: errorMessage,
              errorStack,
              updatedAt: Date.now(),
            },
          }
        ),
      ]);

      this.emit('execution:failed', { executionId, error: errorMessage });

      // Re-queue for immediate retry
      await this.config.redis.rpush(this.queueName, executionId);
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Worcher not running.');
    }
    this.isRunning = false;

    // Wait for all active executions to complete before stopping
    while (this.activeExecutions > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  getFunction(id: string): WorkchflowFunction<any, any> | undefined {
    return this.functionMap.get(id);
  }
}
