import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { ExecutionRecord, WorchflowClientConfig, EventSchemaShape, SendEventPayload } from '../types';
import { ensureIndexes } from '../utils/indexes';
import { saveExecutionToRedis, updateExecutionInRedis, pushToQueue } from '../utils/redis';
import { saveExecutionToMongo, updateExecutionInMongo } from '../utils/mongo';

export class WorchflowClient<TEvents extends EventSchemaShape = EventSchemaShape> extends EventEmitter {
  private config: WorchflowClientConfig<TEvents>;
  private isReady: boolean = false;
  private queuePrefix: string;

  constructor(config: WorchflowClientConfig<TEvents>) {
    super();
    this.config = config;
    this.queuePrefix = config.queuePrefix || 'worchflow';
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await Promise.all([
        this.config.redis.ping(),
        this.config.db.admin().ping(),
        ensureIndexes(this.config.db, this.config.logging ?? false),
      ]);

      this.isReady = true;
      this.emit('ready');
    } catch (error) {
      this.emit('error', error);
    }
  }

  async send(event: SendEventPayload<TEvents>): Promise<string> {
    if (!this.isReady) {
      throw new Error('Client not ready. Wait for "ready" event.');
    }

    const executionId = event.id || randomUUID();
    const now = Date.now();

    const execution: ExecutionRecord = {
      id: executionId,
      eventName: String(event.name),
      eventData: JSON.stringify(event.data),
      status: 'queued',
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Write execution metadata to both Redis (fast access) and MongoDB (persistence)
    await Promise.all([
      saveExecutionToRedis(this.config.redis, this.queuePrefix, execution),
      saveExecutionToMongo(this.config.db, execution),
    ]);
    await pushToQueue(this.config.redis, this.queuePrefix, executionId);

    return executionId;
  }

  async retry(executionId: string): Promise<void> {
    if (!this.isReady) {
      throw new Error('Client not ready. Wait for "ready" event.');
    }

    // Reset attempt count for manual retry
    const now: number = Date.now();
    await Promise.all([
      updateExecutionInRedis(this.config.redis, this.queuePrefix, executionId, {
        attemptCount: 0,
        status: 'queued',
        updatedAt: now,
      }),
      updateExecutionInMongo(
        this.config.db,
        executionId,
        {
          attemptCount: 0,
          status: 'queued',
          updatedAt: now,
        },
        ['error', 'errorStack']
      ),
    ]);
    await pushToQueue(this.config.redis, this.queuePrefix, executionId);
  }
}
