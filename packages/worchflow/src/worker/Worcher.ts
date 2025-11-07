import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import type { WorcherConfig, WorkchflowFunction } from '../types';
import { Step } from '../execution/Step';
import { ensureIndexes } from '../utils/indexes';

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
        ensureIndexes(this.config.db, this.logging),
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

    if (this.logging) {
      console.log(`[Worcher] Starting ${this.concurrency} worker threads...`);
    }

    // Spawn N concurrent workers to process queue
    // Each worker gets its own Redis connection to avoid blocking
    const workers = Array.from({ length: this.concurrency }, (_, i) => {
      const workerRedis = new Redis(this.config.redis.options);
      return this.processQueue(workerRedis, i);
    });
    
    await Promise.all(workers);
  }

  private async processQueue(workerRedis: any, workerId: number): Promise<void> {
    if (this.logging) {
      console.log(`[Worcher] Worker #${workerId} started, polling queue: ${this.queueName}`);
    }
    while (this.isRunning) {
      try {
        // BLPOP is atomic - only one worker gets each executionId
        const result = await workerRedis.blpop(this.queueName, 5);

        if (!result) {
          continue;
        }

        const [, executionId] = result;
        this.activeExecutions++;
        
        if (this.logging) {
          console.log(`[Worcher] Worker #${workerId} picked up execution: ${executionId.slice(0, 8)}... (active: ${this.activeExecutions})`);
        }

        // Process execution without blocking queue polling
        this.processExecution(executionId, workerRedis).finally(() => {
          this.activeExecutions--;
          if (this.logging) {
            console.log(`[Worcher] Worker #${workerId} finished execution: ${executionId.slice(0, 8)}... (active: ${this.activeExecutions})`);
          }
        });
      } catch (error) {
        this.emit('error', error);
        if (this.logging) {
          console.error(`[Worcher] Worker #${workerId} queue processing error:`, error);
        }
      }
    }
    
    // Clean up worker's Redis connection
    workerRedis.disconnect();
    
    if (this.logging) {
      console.log(`[Worcher] Worker #${workerId} stopped`);
    }
  }

  private async processExecution(executionId: string, workerRedis: any): Promise<void> {
    try {
      // Load execution metadata from Redis (using worker's dedicated connection)
      const executionData = await workerRedis.hgetall(
        `${this.queuePrefix}:execution:${executionId}`
      );

      if (!executionData || !executionData.eventName) {
        throw new Error(`Execution ${executionId} not found in Redis`);
      }

      const eventName = executionData.eventName;
      const eventData = JSON.parse(executionData.eventData);
      const attemptCount = parseInt(executionData.attemptCount || '0', 10);

      const workflowFunction = this.functionMap.get(eventName);
      if (!workflowFunction) {
        throw new Error(`No function registered for event: ${eventName}`);
      }

      if (this.logging) {
        console.log(`[Worcher] Started: ${eventName} (${executionId.slice(0, 8)}...) [attempt ${attemptCount + 1}]`);
      }

      this.emit('execution:start', { executionId, eventName, attemptCount: attemptCount + 1 });

      // Create dedicated Redis connection for this execution's steps
      // This prevents BLPOP from blocking step operations
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
      if (this.logging) {
        console.log(`[Worcher] Updating execution ${executionId.slice(0, 8)}... to completed...`);
      }
      
      const updatePromise = Promise.all([
        this.config.redis.hset(
          `${this.queuePrefix}:execution:${executionId}`,
          'status',
          'completed',
          'result',
          JSON.stringify(result),
          'updatedAt',
          String(Date.now())
        ).then((redisResult) => {
          if (this.logging) {
            console.log(`[Worcher] Redis hset result: ${redisResult}, key: ${this.queuePrefix}:execution:${executionId.slice(0, 8)}...`);
          }
        }).catch((err) => {
          console.error(`[Worcher] Redis update FAILED:`, err);
        }),
        this.config.db.collection('executions').updateOne(
          { id: executionId },
          {
            $set: {
              status: 'completed',
              result,
              updatedAt: Date.now(),
            },
          }
        ).then((mongoResult) => {
          if (this.logging) {
            console.log(`[Worcher] MongoDB update result:`, mongoResult.modifiedCount);
          }
        }).catch((err) => {
          console.error(`[Worcher] MongoDB update FAILED:`, err);
        }),
      ]);

      if (this.logging) {
        console.log(`[Worcher] Completed: ${eventName} (${executionId.slice(0, 8)}...)`);
      }

      this.emit('execution:complete', { executionId, result });
      
      await updatePromise;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      if (this.logging) {
        console.error(`[Worcher] Failed: ${executionId.slice(0, 8)}... - ${errorMessage}`);
      }

      // Load execution data to check retry count
      const executionData = await workerRedis.hgetall(
        `${this.queuePrefix}:execution:${executionId}`
      );
      const eventName = executionData?.eventName;
      const attemptCount = parseInt(executionData?.attemptCount || '0', 10);
      
      const workflowFunction = eventName ? this.functionMap.get(eventName) : null;
      const maxRetries = workflowFunction?.retries ?? 0;
      const retryDelay = workflowFunction?.retryDelay ?? 0;
      const shouldRetry = attemptCount < maxRetries;

      if (this.logging) {
        console.log(`[Worcher] Retry status: attempt ${attemptCount + 1}/${maxRetries + 1}, shouldRetry: ${shouldRetry}`);
      }

      // Mark execution as failed in Redis and MongoDB
      await Promise.all([
        workerRedis.hset(
          `${this.queuePrefix}:execution:${executionId}`,
          'status',
          shouldRetry ? 'retrying' : 'failed',
          'error',
          errorMessage,
          'attemptCount',
          String(attemptCount + 1),
          'updatedAt',
          String(Date.now())
        ),
        this.config.db.collection('executions').updateOne(
          { id: executionId },
          {
            $set: {
              status: shouldRetry ? 'retrying' : 'failed',
              error: errorMessage,
              errorStack,
              attemptCount: attemptCount + 1,
              updatedAt: Date.now(),
            },
          }
        ),
      ]);

      this.emit('execution:failed', { executionId, error: errorMessage, attemptCount: attemptCount + 1, willRetry: shouldRetry });

      // Re-queue for retry if within retry limit
      if (shouldRetry && this.isRunning) { // Only retry if worker is still running
        if (retryDelay > 0) {
          // Schedule retry with delay
          setTimeout(async () => {
            if (!this.isRunning) return; // Double-check before retry
            await this.config.redis.rpush(this.queueName, executionId);
            if (this.logging) {
              console.log(`[Worcher] Retrying ${executionId.slice(0, 8)}... after ${retryDelay}ms delay`);
            }
          }, retryDelay);
        } else {
          // Immediate retry
          await this.config.redis.rpush(this.queueName, executionId);
          if (this.logging) {
            console.log(`[Worcher] Retrying ${executionId.slice(0, 8)}... immediately`);
          }
        }
      }
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
