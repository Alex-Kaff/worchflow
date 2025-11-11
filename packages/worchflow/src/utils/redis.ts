import type { Redis } from 'ioredis';
import type { ExecutionData, ExecutionRecord, ExecutionStatus, QueueItem } from '../types';

export function getExecutionKey(queuePrefix: string, executionId: string): string {
  return `${queuePrefix}:execution:${executionId}`;
}

export async function saveExecutionToRedis(
  redis: Redis,
  queuePrefix: string,
  execution: ExecutionRecord
): Promise<void> {
  const key: string = getExecutionKey(queuePrefix, execution.id);
  const redisData: Record<string, string> = {
    id: execution.id,
    eventName: execution.eventName,
    eventData: execution.eventData,
    status: execution.status,
    attemptCount: String(execution.attemptCount),
    createdAt: String(execution.createdAt),
    updatedAt: String(execution.updatedAt),
  };
  await redis.hset(key, redisData);
}

export async function getExecutionFromRedis(
  redis: Redis,
  queuePrefix: string,
  executionId: string
): Promise<ExecutionData> {
  const key: string = getExecutionKey(queuePrefix, executionId);
  const data: ExecutionData = await redis.hgetall(key) as ExecutionData;
  return data;
}

export async function updateExecutionInRedis(
  redis: Redis,
  queuePrefix: string,
  executionId: string,
  updates: Partial<{
    status: ExecutionStatus;
    result: any;
    error: string;
    attemptCount: number;
    updatedAt: number;
  }>
): Promise<void> {
  const key: string = getExecutionKey(queuePrefix, executionId);
  const redisUpdates: Record<string, string> = {};

  if (updates.status !== undefined) {
    redisUpdates.status = updates.status;
  }
  if (updates.result !== undefined) {
    redisUpdates.result = JSON.stringify(updates.result);
  }
  if (updates.error !== undefined) {
    redisUpdates.error = updates.error;
  }
  if (updates.attemptCount !== undefined) {
    redisUpdates.attemptCount = String(updates.attemptCount);
  }
  if (updates.updatedAt !== undefined) {
    redisUpdates.updatedAt = String(updates.updatedAt);
  }

  if (Object.keys(redisUpdates).length > 0) {
    await redis.hset(key, redisUpdates);
  }
}

export function getStepsKey(queuePrefix: string, executionId: string): string {
  return `${queuePrefix}:steps:${executionId}`;
}

export async function saveStepToRedis<TStepResult>(
  redis: Redis,
  queuePrefix: string,
  executionId: string,
  stepId: string,
  result: TStepResult
): Promise<void> {
  const key: string = getStepsKey(queuePrefix, executionId);
  // Wrap result with explicit flag to distinguish "no cache" from "cached undefined/null"
  // JSON.stringify omits undefined properties, so we use a different serialization
  const wrapped = { cached: true, value: result };
  await redis.hset(key, stepId, JSON.stringify(wrapped, (_, v) => v === undefined ? null : v));
}

export async function getStepFromRedis<TStepResult>(
  redis: Redis,
  queuePrefix: string,
  executionId: string,
  stepId: string
): Promise<TStepResult | undefined> {
  const key: string = getStepsKey(queuePrefix, executionId);
  const cachedResult: string | null = await redis.hget(key, stepId);
  
  // Return undefined for cache miss
  if (cachedResult === null || cachedResult === '') {
    return undefined;
  }
  
  try {
    // Unwrap the value - check for 'cached' flag to ensure it's valid
    const wrapped = JSON.parse(cachedResult) as { cached?: boolean; value: TStepResult };
    if (wrapped.cached === true) {
      return wrapped.value;
    }
    return undefined;
  } catch (error) {
    console.error(`[Redis] Failed to parse cached step result for ${stepId}:`, cachedResult, error);
    return undefined;
  }
}

export async function pushToQueue(
  redis: Redis,
  queuePrefix: string,
  executionId: string
): Promise<void> {
  const queueName = `${queuePrefix}:queue`;
  await redis.rpush(queueName, executionId);
}

export async function popFromQueue(
  redis: Redis,
  queueName: string,
  timeoutSeconds: number
): Promise<QueueItem | null> {
  const result: [string, string] | null = await redis.blpop(queueName, timeoutSeconds);
  
  if (!result) {
    return null;
  }
  
  const [queueName_, executionId]: [string, string] = result;
  
  return {
    queueName: queueName_,
    executionId,
  };
}

