import type { Redis } from 'ioredis';
import type { Db } from 'mongodb';
import type { StepContext } from '../types';
import { hashStepTitle } from '../utils/hash';

export class Step implements StepContext {
  private executionId: string;
  private redis: Redis;
  private db: Db;
  private queuePrefix: string;
  private completedSteps: Map<string, any> = new Map();

  constructor(executionId: string, redis: Redis, db: Db, queuePrefix: string = 'worchflow') {
    this.executionId = executionId;
    this.redis = redis;
    this.db = db;
    this.queuePrefix = queuePrefix;
  }

  async run<T>(title: string, fn: () => Promise<T>): Promise<T> {
    const stepId = hashStepTitle(title);

    // Check in-memory cache first
    if (this.completedSteps.has(stepId)) {
      return this.completedSteps.get(stepId) as T;
    }

    // Check Redis cache for previously completed step
    const cachedResult = await this.redis.hget(
      `${this.queuePrefix}:steps:${this.executionId}`,
      stepId
    );

    if (cachedResult !== null) {
      const result = JSON.parse(cachedResult) as T;
      this.completedSteps.set(stepId, result);
      return result;
    }

    // Execute step function for the first time
    const result = await fn();

    // Save result to both Redis (fast retry) and MongoDB (persistence)
    await Promise.all([
      this.redis.hset(
        `${this.queuePrefix}:steps:${this.executionId}`,
        stepId,
        JSON.stringify(result)
      ),
      this.db.collection('steps').insertOne({
        executionId: this.executionId,
        stepId,
        result,
        timestamp: Date.now(),
      }),
    ]);

    this.completedSteps.set(stepId, result);
    return result;
  }

  getExecutionId(): string {
    return this.executionId;
  }
}
