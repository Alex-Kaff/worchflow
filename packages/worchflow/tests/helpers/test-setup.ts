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
  dbName: string;
  cleanup: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const queuePrefix = `test:${randomUUID().slice(0, 8)}`;
  const dbName = `worchflow_test_${queuePrefix.replace(':', '_')}`;
  
  const redis = new Redis({
    host: 'localhost',
    port: 6379,
    lazyConnect: true,
  });
  
  const redisWorker = redis.duplicate();
  
  const mongoClient = new MongoClient('mongodb://localhost:27017');
  
  await Promise.all([
    redis.connect(),
    redisWorker.connect(),
    mongoClient.connect(),
  ]);
  
  const db = mongoClient.db(dbName);
  
  const cleanup = async () => {
    const pattern = `${queuePrefix}*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    
    // Drop the entire test database to ensure complete isolation
    await db.dropDatabase();
    
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
    dbName,
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

export async function waitForExecutionEvent(
  worcher: Worcher,
  executionId: string,
  db: Db,
  timeoutMs: number = 5000
): Promise<{ status: 'completed' | 'failed' | 'retrying'; execution: any }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(async () => {
      cleanup();
      
      const execution = await db.collection('executions').findOne({ id: executionId });
      const steps = await db.collection('steps').find({ executionId }).toArray();
      
      console.error(`\n[TIMEOUT] Execution ${executionId} did not complete within ${timeoutMs}ms`);
      console.error('[TIMEOUT] Execution state:', JSON.stringify(execution, null, 2));
      console.error('[TIMEOUT] Steps:', JSON.stringify(steps, null, 2));
      
      reject(new Error(`Execution ${executionId} did not complete within ${timeoutMs}ms`));
    }, timeoutMs);

    const onUpdated = async ({ executionId: id, status }: { executionId: string; status: 'completed' | 'failed' | 'retrying' }) => {
      if (id === executionId) {
        // Only resolve for final states (not retrying)
        if (status === 'completed' || status === 'failed') {
          cleanup();
          const execution = await db.collection('executions').findOne({ id: executionId });
          resolve({ status, execution });
        }
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      worcher.off('execution:updated', onUpdated);
    };

    worcher.on('execution:updated', onUpdated);
  });
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

