import type { Redis } from 'ioredis';
import type { Db } from 'mongodb';
import type { StepContext, StepRecord } from '../types';
import { hashStepTitle } from '../utils/hash';
import { saveStepToMongo } from '../utils/mongo';
import { saveStepToRedis, getStepFromRedis } from '../utils/redis';

export class Step implements StepContext {
  private executionId: string;
  private redis: Redis;
  private db: Db;
  private queuePrefix: string;
  private completedSteps: Map<string, unknown> = new Map();

  constructor(executionId: string, redis: Redis, db: Db, queuePrefix: string = 'worchflow') {
    this.executionId = executionId;
    this.redis = redis;
    this.db = db;
    this.queuePrefix = queuePrefix;
  }

  async run<TStepResult>(title: string, fn: () => Promise<TStepResult>): Promise<TStepResult> {
    const stepId: string = hashStepTitle(title);

    // Check in-memory cache first
    if (this.completedSteps.has(stepId)) {
      return this.completedSteps.get(stepId) as TStepResult;
    }

    // Check Redis cache for previously completed step
    const cacheResult = await getStepFromRedis<TStepResult>(
      this.redis,
      this.queuePrefix,
      this.executionId,
      stepId
    );

    // Cache hit (undefined means cache miss, any other value including null is cached)
    if (cacheResult !== undefined) {
      this.completedSteps.set(stepId, cacheResult);
      return cacheResult;
    }

    // Cache miss: execute step function for the first time
    const result: TStepResult = await fn();

    // Save result to both Redis (fast retry) and MongoDB (persistence)
    const stepRecord: StepRecord = {
      executionId: this.executionId,
      stepId,
      name: title,
      status: 'completed',
      result,
      timestamp: Date.now(),
    };

    await Promise.all([
      saveStepToRedis<TStepResult>(this.redis, this.queuePrefix, this.executionId, stepId, result),
      saveStepToMongo(this.db, stepRecord),
    ]);

    this.completedSteps.set(stepId, result);
    return result;
  }

  getExecutionId(): string {
    return this.executionId;
  }
}
