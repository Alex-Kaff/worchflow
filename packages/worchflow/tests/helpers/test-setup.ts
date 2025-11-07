import Redis from 'ioredis';
import { MongoClient, Db } from 'mongodb';
import { randomUUID } from 'crypto';
import { Worcher } from '../../src';

export interface TestContext {
  redis: Redis;
  redisWorker: Redis;
  mongoClient: MongoClient;
  db: Db;
  queuePrefix: string;
  cleanup: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const queuePrefix = `test:${randomUUID().slice(0, 8)}`;
  
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    lazyConnect: true,
  });
  
  const redisWorker = new Redis({
    host: 'localhost',
    port: 6379,
    lazyConnect: true,
  });
  
  const mongoClient = new MongoClient('mongodb://localhost:27017');
  
  await Promise.all([
    redis.connect(),
    redisWorker.connect(),
    mongoClient.connect(),
  ]);
  
  const db = mongoClient.db('worchflow_test');
  
  const cleanup = async () => {
    const pattern = `${queuePrefix}*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    await db.collection('executions').deleteMany({});
    await db.collection('steps').deleteMany({});
    
    redis.disconnect();
    redisWorker.disconnect();
    await mongoClient.close();
  };
  
  return {
    redis,
    redisWorker,
    mongoClient,
    db,
    queuePrefix,
    cleanup,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForExecution(
  db: Db,
  executionId: string,
  status: string,
  timeoutMs: number = 5000
): Promise<any> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const execution = await db.collection('executions').findOne({ id: executionId });
    
    if (execution && execution.status === status) {
      return execution;
    }
    
    await sleep(100);
  }
  
  throw new Error(`Execution ${executionId} did not reach status ${status} within ${timeoutMs}ms`);
}

export async function getSteps(db: Db, executionId: string): Promise<any[]> {
  return await db.collection('steps').find({ executionId }).toArray();
}

export async function startWorcher(worcher: Worcher): Promise<void> {
  await new Promise<void>((resolve) => {
    worcher.on('ready', resolve);
  });
  
  worcher.start();
  
  await sleep(200);
}

