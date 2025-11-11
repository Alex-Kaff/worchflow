import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import type { ExecutionData, FunctionContext, WorcherConfig, WorkchflowFunction, QueueItem } from '../types';
import { Step } from '../execution/Step';
import { ensureIndexes } from '../utils/indexes';
import { getExecutionFromRedis, updateExecutionInRedis, popFromQueue, saveExecutionToRedis, pushToQueue } from '../utils/redis';
import { updateExecutionInMongo, getOrphanedExecutions } from '../utils/mongo';

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
  private instanceId: string;

  constructor(config: WorcherConfig, functions: WorkchflowFunction<any, any>[] = []) {
    super();
    this.instanceId = Math.random().toString(36).substring(2, 6);
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

    await this.recoverOrphanedExecutions();

    // Spawn N concurrent workers to process queue
    // Each worker gets its own Redis connection to avoid blocking
    const workers: Promise<void>[] = Array.from({ length: this.concurrency }, (_, i) => {
      const workerRedis: Redis = this.config.redis.duplicate();
      return this.processQueue(workerRedis, i);
    });
    
    await Promise.all(workers);
  }

  // Find executions stuck in 'processing' or 'retrying' status and recover
  private async recoverOrphanedExecutions(): Promise<void> {
    try {
      const orphanedExecutions = await getOrphanedExecutions(this.config.db);
      
      if (orphanedExecutions.length > 0) {
        if (this.logging) {
          console.log(`[Worcher] Found ${orphanedExecutions.length} orphaned execution(s), re-queueing...`);
        }
        
        const now = Date.now();
        for (const execution of orphanedExecutions) {
          const restoredExecution = {
            ...execution,
            status: 'queued' as const,
            updatedAt: now,
          };
          
          await Promise.all([
            saveExecutionToRedis(this.config.redis, this.queuePrefix, restoredExecution),
            updateExecutionInMongo(this.config.db, execution.id, {
              status: 'queued',
              updatedAt: now,
            }),
          ]);
          await pushToQueue(this.config.redis, this.queuePrefix, execution.id);
          
          if (this.logging) {
            console.log(`[Worcher] Recovered execution: ${execution.id.slice(0, 8)}... (${execution.eventName}, was: ${execution.status})`);
          }
        }
      } else if (this.logging) {
        console.log(`[Worcher] No orphaned executions found`);
      }
    } catch (error) {
      if (this.logging) {
        console.error(`[Worcher] Error recovering orphaned executions:`, error);
      }
      this.emit('error', error);
    }
  }

  private async processQueue(workerRedis: Redis, workerId: number): Promise<void> {
    if (this.logging) {
      console.log(`[Worcher:${this.instanceId}] Worker #${workerId} started, polling queue: ${this.queueName}`);
    }
    
    const activePromises: Set<Promise<void>> = new Set();
    
    while (this.isRunning) {
      try {
        const queueItem: QueueItem | null = await popFromQueue(workerRedis, this.queueName, 5);

        if (!queueItem) {
          // No work available, check if we should exit
          if (!this.isRunning) {
            if (this.logging) {
              console.log(`[Worcher:${this.instanceId}] Worker #${workerId} exiting: isRunning=false, no pending retries`);
            }
            break;
          }
          continue;
        }

        const executionId = queueItem.executionId;
        this.activeExecutions++;
        
        if (this.logging) {
          console.log(`[Worcher] Worker #${workerId} picked up execution: ${executionId.slice(0, 8)}... (active: ${this.activeExecutions}`);
        }

        // Process execution without blocking queue polling
        const executionPromise = this.processExecution(executionId, workerRedis).finally(() => {
          this.activeExecutions--;
          activePromises.delete(executionPromise);
          if (this.logging) {
            console.log(`[Worcher] Worker #${workerId} finished execution: ${executionId.slice(0, 8)}... (active: ${this.activeExecutions}`);
          }
        });
        
        activePromises.add(executionPromise);
      } catch (error) {
        this.emit('error', error);
        if (this.logging) {
          console.error(`[Worcher] Worker #${workerId} queue processing error:`, error);
        }
      }
    }
    
    // Wait for all active executions on this worker to complete before disconnecting
    if (activePromises.size > 0) {
      if (this.logging) {
        console.log(`[Worcher] Worker #${workerId} waiting for ${activePromises.size} active executions to complete...`);
      }
      await Promise.all(Array.from(activePromises));
    }
    
    workerRedis.disconnect();
    
    if (this.logging) {
      console.log(`[Worcher] Worker #${workerId} stopped`);
    }
  }

  private async processExecution(executionId: string, workerRedis: Redis): Promise<void> {
    let stepRedis: Redis | null = null;
    
    try {
      const executionData: ExecutionData = await getExecutionFromRedis(
        this.config.redis,
        this.queuePrefix,
        executionId
      );

      if (this.logging) {
        console.log(`[Worcher] Loaded execution data for ${executionId.slice(0, 8)}:`, {
          eventName: executionData?.eventName,
          eventData: executionData?.eventData,
          eventDataLength: executionData?.eventData?.length,
          attemptCount: executionData?.attemptCount
        });
      }

      if (!executionData || !executionData.eventName || !executionData.eventData || !executionData.createdAt) {
        if (this.logging) {
          console.error(`[Worcher] Missing execution data:`, {
            hasData: !!executionData,
            eventName: executionData?.eventName,
            hasEventData: !!executionData?.eventData,
            eventDataLength: executionData?.eventData?.length,
            createdAt: executionData?.createdAt
          });
        }
        throw new Error(`Execution ${executionId} not found in Redis or missing required fields`);
      }

      const eventName: string = executionData.eventName;
      let eventData: any;
      try {
        eventData = JSON.parse(executionData.eventData);
      } catch (parseError) {
        if (this.logging) {
          console.error(`[Worcher] Failed to parse eventData:`, {
            eventData: executionData.eventData,
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
        }
        throw parseError;
      }
      const attemptCount: number = parseInt(executionData.attemptCount || '0', 10);

      const workflowFunction: WorkchflowFunction<any, any> | undefined = this.functionMap.get(eventName);
      if (!workflowFunction) {
        throw new Error(`No function registered for event: ${eventName}`);
      }

      if (this.logging) {
        console.log(`[Worcher] Started: ${eventName} (${executionId.slice(0, 8)}...) [attempt ${attemptCount}]`);
      }

      const startTime = Date.now();
      await Promise.all([
        updateExecutionInRedis(this.config.redis, this.queuePrefix, executionId, {
          status: 'processing',
          updatedAt: startTime,
        }),
        updateExecutionInMongo(this.config.db, executionId, {
          status: 'processing',
          updatedAt: startTime,
        }),
      ]);

      this.emit('execution:start', { executionId, eventName, attemptCount });

      // This prevents BLPOP from blocking step operations
      stepRedis = this.config.redis.duplicate();

      const step: Step = new Step(
        executionId,
        stepRedis,
        this.config.db,
        this.queuePrefix
      );

      const context: FunctionContext = {
        event: {
          name: eventName,
          data: eventData,
          id: executionId,
          timestamp: Number(executionData.createdAt),
        },
        step,
      };

      const result: any = await workflowFunction.execute(context);

      if (this.logging) {
        console.log(`[Worcher] Updating execution ${executionId.slice(0, 8)}... to completed...`);
      }
      
      const now: number = Date.now();
      const updatePromise: Promise<[void, void]> = Promise.all([
        updateExecutionInRedis(this.config.redis, this.queuePrefix, executionId, {
          status: 'completed',
          result,
          attemptCount,
          updatedAt: now,
        }).then(() => {
          if (this.logging) {
            console.log(`[Worcher] Redis update complete for execution: ${executionId.slice(0, 8)}...`);
          }
        }).catch((err) => {
          console.error(`[Worcher] Redis update FAILED:`, err);
        }),
        updateExecutionInMongo(this.config.db, executionId, {
          status: 'completed',
          result,
          attemptCount,
          updatedAt: now,
        }).then(() => {
          if (this.logging) {
            console.log(`[Worcher] MongoDB update complete for execution: ${executionId.slice(0, 8)}...`);
          }
        }).catch((err) => {
          console.error(`[Worcher] MongoDB update FAILED:`, err);
        }),
      ]);

      if (this.logging) {
        console.log(`[Worcher] Completed: ${eventName} (${executionId.slice(0, 8)}...)`);
      }
      
      await updatePromise;
      
      this.emit('execution:complete', { executionId, result });
      this.emit('execution:updated', { executionId, status: 'completed', result });
    } catch (error) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const errorStack: string | undefined = error instanceof Error ? error.stack : undefined;

      if (this.logging) {
        console.error(`[Worcher] Failed: ${executionId.slice(0, 8)}... - ${errorMessage}`);
      }

      const executionData: ExecutionData = await getExecutionFromRedis(
        this.config.redis,
        this.queuePrefix,
        executionId
      );
      const eventName: string | undefined = executionData?.eventName;
      const attemptCount: number = parseInt(executionData?.attemptCount || '0', 10);
      
      const workflowFunction: WorkchflowFunction<any, any> | null | undefined = eventName ? this.functionMap.get(eventName) : null;
      const maxRetries: number = workflowFunction?.retries ?? 0;
      const retryDelay: number = workflowFunction?.retryDelay ?? 0;
      const shouldRetry: boolean = attemptCount < maxRetries;

      if (this.logging) {
        console.log(`[Worcher] Retry status: attempt ${attemptCount + 1}/${maxRetries + 1}, shouldRetry: ${shouldRetry}`);
      }

      const now: number = Date.now();
      await Promise.all([
        updateExecutionInRedis(this.config.redis, this.queuePrefix, executionId, {
          status: shouldRetry ? 'retrying' : 'failed',
          error: errorMessage,
          attemptCount: attemptCount + 1,
          updatedAt: now,
        }),
        updateExecutionInMongo(this.config.db, executionId, {
          status: shouldRetry ? 'retrying' : 'failed',
          error: errorMessage,
          errorStack,
          attemptCount: attemptCount + 1,
          updatedAt: now,
        }),
      ]);

      this.emit('execution:failed', { executionId, error: errorMessage, attemptCount: attemptCount + 1, willRetry: shouldRetry });
      this.emit('execution:updated', { executionId, status: shouldRetry ? 'retrying' : 'failed', error: errorMessage, attemptCount: attemptCount + 1 });

      if (shouldRetry && this.isRunning) { // Only retry if worker is still running
        
        if (this.logging) {
          console.log(`[Worcher] Queueing ${executionId.slice(0, 8)}... for retry`);
        }
        
        if (retryDelay > 0) {
          setTimeout(async () => {
            if (!this.isRunning) {
              return;
            }
            await pushToQueue(this.config.redis, this.queuePrefix, executionId);
            if (this.logging) {
              console.log(`[Worcher] Retrying ${executionId.slice(0, 8)}... after ${retryDelay}ms delay`);
            }
          }, retryDelay);
        } else {
          await pushToQueue(this.config.redis, this.queuePrefix, executionId);
          if (this.logging) {
            console.log(`[Worcher] Retrying ${executionId.slice(0, 8)}... immediately`);
          }
        }
      }
    } finally {
      if (stepRedis) {
        stepRedis.disconnect();
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Worcher not running.');
    }
    
    if (this.logging) {
      console.log(`[Worcher:${this.instanceId}] Stop called: activeExecutions=${this.activeExecutions}`);
    }
    
    this.isRunning = false;

    while (this.activeExecutions > 0) {
      if (this.logging) {
        console.log(`[Worcher] Waiting for ${this.activeExecutions} active executions...`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (this.logging) {
      console.log(`[Worcher] Stop complete: all executions and retries finished`);
    }
  }

  getFunction(id: string): WorkchflowFunction<any, any> | undefined {
    return this.functionMap.get(id);
  }
}
