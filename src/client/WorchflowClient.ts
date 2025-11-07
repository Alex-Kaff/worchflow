import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { WorchflowClientConfig, EventSchemaShape, SendEventPayload } from '../types';

export class WorchflowClient<TEvents extends EventSchemaShape = EventSchemaShape> extends EventEmitter {
  private config: WorchflowClientConfig<TEvents>;
  private isReady: boolean = false;
  private queuePrefix: string;
  private queueName: string;

  constructor(config: WorchflowClientConfig<TEvents>) {
    super();
    this.config = config;
    this.queuePrefix = config.queuePrefix || 'worchflow';
    this.queueName = `${this.queuePrefix}:queue`;
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

  async send(event: SendEventPayload<TEvents>): Promise<string> {
    if (!this.isReady) {
      throw new Error('Client not ready. Wait for "ready" event.');
    }

    const executionId = event.id || randomUUID();
    const now = Date.now();

    const execution = {
      id: executionId,
      eventName: String(event.name),
      eventData: JSON.stringify(event.data),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };

    // Write execution metadata to both Redis (fast access) and MongoDB (persistence)
    await Promise.all([
      this.config.redis.hset(
        `${this.queuePrefix}:execution:${executionId}`,
        execution
      ),
      this.config.db.collection('executions').insertOne(execution),
    ]);

    // Add executionId to queue for workers to process
    await this.config.redis.rpush(this.queueName, executionId);

    return executionId;
  }
}
