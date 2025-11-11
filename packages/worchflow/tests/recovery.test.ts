import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Worcher, createFunction, WorchflowClient } from '../src';
import { createTestContext, waitForExecution, getSteps } from './helpers/test-setup';
import type { TestContext } from './helpers/test-setup';

type TestEvents = {
  'recovery-test': { data: { value: number } };
};

describe('Execution Recovery', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    await context.cleanup();
  });

  it('should recover orphaned executions on worker start', async () => {
    const steps: string[] = [];

    const testFunction = createFunction<TestEvents, 'recovery-test'>(
      { id: 'recovery-test' },
      async ({ event, step }) => {
        const step1 = await step.run('Step 1', async () => {
          steps.push('step1');
          return event.data.value * 2;
        });

        const step2 = await step.run('Step 2', async () => {
          steps.push('step2');
          return step1 + 10;
        });

        return { result: step2 };
      }
    );

    // Create client and send an event
    const client = new WorchflowClient<TestEvents>({
      redis: context.redis,
      db: context.db,
      queuePrefix: context.queuePrefix,
    });

    await new Promise((resolve) => {
      client.on('ready', resolve);
    });

    const executionId = await client.send({
      name: 'recovery-test',
      data: { value: 5 },
    });

    console.log(`[TEST] Created execution: ${executionId.slice(0, 8)}`);

    // Manually set execution status to 'processing' to simulate a crash
    await context.db.collection('executions').updateOne(
      { id: executionId },
      { $set: { status: 'processing', updatedAt: Date.now() } }
    );

    console.log(`[TEST] Set execution to 'processing' status (simulating crash)`);

    // Remove from queue to simulate it was already dequeued
    await context.redis.del(`${context.queuePrefix}:queue`);

    console.log(`[TEST] Cleared queue`);

    // Now start a worker - it should recover the orphaned execution
    const worcher = new Worcher(
      {
        redis: context.redisWorker,
        db: context.db,
        queuePrefix: context.queuePrefix,
        logging: true,
      },
      [testFunction]
    );

    await new Promise((resolve) => {
      worcher.on('ready', resolve);
    });

    console.log(`[TEST] Starting worker to recover orphaned execution...`);

    // Start worker in background
    const workerPromise = worcher.start();

    // Wait for execution to complete
    await waitForExecution(context.db, executionId, 'completed', 10000);

    console.log(`[TEST] Execution completed after recovery`);

    // Stop worker
    await worcher.stop();
    await workerPromise;

    // Verify execution completed successfully
    const execution = await context.db
      .collection('executions')
      .findOne({ id: executionId });

    expect(execution?.status).toBe('completed');
    expect(execution?.result).toEqual({ result: 20 });

    // Verify steps executed
    const executedSteps = await getSteps(context.db, executionId);
    expect(executedSteps).toHaveLength(2);
    expect(executedSteps[0].name).toBe('Step 1');
    expect(executedSteps[0].result).toBe(10);
    expect(executedSteps[1].name).toBe('Step 2');
    expect(executedSteps[1].result).toBe(20);

    console.log(`[TEST] ✓ Recovery test passed`);
  });

  it('should not re-execute completed steps on recovery', async () => {
    let step1Executions = 0;
    let step2Executions = 0;

    const testFunction = createFunction<TestEvents, 'recovery-test'>(
      { id: 'recovery-test' },
      async ({ event, step }) => {
        const step1 = await step.run('Step 1', async () => {
          step1Executions++;
          return event.data.value * 2;
        });

        const step2 = await step.run('Step 2', async () => {
          step2Executions++;
          return step1 + 10;
        });

        return { result: step2 };
      }
    );

    const client = new WorchflowClient<TestEvents>({
      redis: context.redis,
      db: context.db,
      queuePrefix: context.queuePrefix,
    });

    await new Promise((resolve) => {
      client.on('ready', resolve);
    });

    const executionId = await client.send({
      name: 'recovery-test',
      data: { value: 5 },
    });

    console.log(`[TEST] Created execution: ${executionId.slice(0, 8)}`);

    // Start first worker that will execute step 1 only
    const worcher1 = new Worcher(
      {
        redis: context.redisWorker,
        db: context.db,
        queuePrefix: context.queuePrefix,
        logging: true,
      },
      [
        createFunction<TestEvents, 'recovery-test'>(
          { id: 'recovery-test' },
          async ({ event, step }) => {
            await step.run('Step 1', async () => {
              step1Executions++;
              console.log(`[TEST] Step 1 executed (count: ${step1Executions})`);
              return event.data.value * 2;
            });

            // Simulate crash before step 2
            console.log(`[TEST] Simulating crash before Step 2`);
            throw new Error('Simulated crash');
          }
        ),
      ]
    );

    await new Promise((resolve) => {
      worcher1.on('ready', resolve);
    });

    console.log(`[TEST] Starting first worker (will crash after step 1)...`);
    const worker1Promise = worcher1.start();

    // Wait for execution to fail
    await waitForExecution(context.db, executionId, 'failed', 10000);

    console.log(`[TEST] First worker failed as expected`);

    await worcher1.stop();
    await worker1Promise;

    // Verify step 1 was executed once
    expect(step1Executions).toBe(1);

    // Check what's in Redis step cache
    const stepCacheKey = `${context.queuePrefix}:steps:${executionId}`;
    const cachedSteps = await context.redis.hgetall(stepCacheKey);
    console.log(`[TEST] Redis step cache:`, cachedSteps);

    // Clear the queue to ensure execution isn't already queued
    await context.redis.del(`${context.queuePrefix}:queue`);

    // Manually set execution back to 'processing' in BOTH MongoDB and Redis to simulate it being recovered
    await Promise.all([
      context.db.collection('executions').updateOne(
        { id: executionId },
        { $set: { status: 'processing', updatedAt: Date.now() } }
      ),
      context.redis.hset(
        `${context.queuePrefix}:execution:${executionId}`,
        'status', 'processing',
        'updatedAt', Date.now().toString()
      ),
    ]);

    // Start second worker with the full function
    const worcher2 = new Worcher(
      {
        redis: context.redis.duplicate(),
        db: context.db,
        queuePrefix: context.queuePrefix,
        logging: true,
      },
      [testFunction]
    );

    await new Promise((resolve) => {
      worcher2.on('ready', resolve);
    });

    console.log(`[TEST] Starting second worker to complete execution...`);
    console.log(`[TEST] step1Executions BEFORE second worker: ${step1Executions}`);
    const worker2Promise = worcher2.start();

    // Wait for execution to complete
    await waitForExecution(context.db, executionId, 'completed', 10000);

    console.log(`[TEST] Second worker completed execution`);
    console.log(`[TEST] step1Executions AFTER second worker: ${step1Executions}`);
    console.log(`[TEST] step2Executions AFTER second worker: ${step2Executions}`);

    await worcher2.stop();
    await worker2Promise;

    // Verify step 1 was NOT re-executed (still 1) and step 2 executed once
    expect(step1Executions).toBe(1);
    expect(step2Executions).toBe(1);

    // Verify final result
    const execution = await context.db
      .collection('executions')
      .findOne({ id: executionId });

    expect(execution?.status).toBe('completed');
    expect(execution?.result).toEqual({ result: 20 });

    console.log(`[TEST] ✓ Step checkpointing preserved across recovery`);
  });

  it('should recover executions stuck in retrying status', async () => {
    const testFunction = createFunction<TestEvents, 'recovery-test'>(
      {
        id: 'recovery-test',
        retries: 2,
        retryDelay: 5000, // 5 second delay
      },
      async ({ event, step }) => {
        const step1 = await step.run('Step 1', async () => {
          return event.data.value * 2;
        });

        return { result: step1 };
      }
    );

    const client = new WorchflowClient<TestEvents>({
      redis: context.redis,
      db: context.db,
      queuePrefix: context.queuePrefix,
    });

    await new Promise((resolve) => {
      client.on('ready', resolve);
    });

    const executionId = await client.send({
      name: 'recovery-test',
      data: { value: 5 },
    });

    console.log(`[TEST] Created execution: ${executionId.slice(0, 8)}`);

    // Manually set execution to 'retrying' status to simulate a crash during retry delay
    // Update both MongoDB and Redis to properly simulate a failed first attempt
    await Promise.all([
      context.db.collection('executions').updateOne(
        { id: executionId },
        {
          $set: {
            status: 'retrying',
            error: 'Previous failure',
            attemptCount: 1,
            updatedAt: Date.now(),
          },
        }
      ),
      context.redis.hset(
        `${context.queuePrefix}:execution:${executionId}`,
        'status', 'retrying',
        'error', 'Previous failure',
        'attemptCount', '1',
        'updatedAt', Date.now().toString()
      ),
    ]);

    console.log(`[TEST] Set execution to 'retrying' status (simulating crash during retry delay)`);

    // Clear queue (execution should not be in queue yet due to delay)
    await context.redis.del(`${context.queuePrefix}:queue`);

    // Start worker - it should recover the retrying execution
    const worcher = new Worcher(
      {
        redis: context.redisWorker,
        db: context.db,
        queuePrefix: context.queuePrefix,
        logging: true,
      },
      [testFunction]
    );

    await new Promise((resolve) => {
      worcher.on('ready', resolve);
    });

    console.log(`[TEST] Starting worker to recover retrying execution...`);

    const workerPromise = worcher.start();

    // Wait for execution to complete
    await waitForExecution(context.db, executionId, 'completed', 10000);

    console.log(`[TEST] Execution completed after recovery from retrying status`);

    await worcher.stop();
    await workerPromise;

    // Verify execution completed successfully
    const execution = await context.db
      .collection('executions')
      .findOne({ id: executionId });

    expect(execution?.status).toBe('completed');
    expect(execution?.result).toEqual({ result: 10 });
    expect(execution?.attemptCount).toBe(1); // Preserves attempt count from before crash

    console.log(`[TEST] ✓ Retrying execution recovery test passed`);
  });
});

