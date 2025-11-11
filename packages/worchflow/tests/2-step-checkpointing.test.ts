import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorchflowClient, Worcher, createFunction } from '../src';
import { createTestContext, waitForExecution, waitForExecutionEvent, sleep, startWorcher, TestContext } from './helpers/test-setup';

type TestEvents = {
  'checkpoint-event': {
    data: {
      value: string;
      failAt?: number;
    };
  };
  'resume-event': {
    data: {
      steps: number;
      failAt?: number;
    };
  };
};

describe('Step Checkpointing Tests', () => {
  let ctx: TestContext;
  let client: WorchflowClient<TestEvents>;
  let worcher: Worcher;

  beforeEach(async () => {
    console.log('[TEST] Setting up test context...');
    ctx = await createTestContext();
    console.log(`[TEST] Test context created with prefix: ${ctx.queuePrefix}`);
  });

  afterEach(async () => {
    console.log('[TEST] Cleaning up...');
    if (worcher) {
      console.log('[TEST] Stopping worcher...');
      await worcher.stop();
      console.log('[TEST] Worcher stopped');
    }
    await ctx.cleanup();
    console.log('[TEST] Cleanup complete');
  });

  describe('2.1 Step Checkpoint Recovery', () => {
    it('should resume from last checkpoint after failure', async () => {
      console.log('[TEST] Testing checkpoint recovery after failure...');

      let executionCount = 0;
      let step1Executions = 0;
      let step2Executions = 0;
      let step3Executions = 0;

      const failingFunction = createFunction<TestEvents, 'checkpoint-event'>(
        { id: 'checkpoint-event', retries: 1 }, // Allow 1 retry
        async ({ event, step }) => {
          executionCount++;
          console.log(`[FUNCTION] Execution attempt #${executionCount}`);

          const result1 = await step.run('Step 1: Init', async () => {
            step1Executions++;
            console.log(`[FUNCTION] Step 1 executed (count: ${step1Executions})`);
            return 'step1-done';
          });

          const result2 = await step.run('Step 2: Process', async () => {
            step2Executions++;
            console.log(`[FUNCTION] Step 2 executed (count: ${step2Executions})`);
            
            if (executionCount === 1) {
              console.log('[FUNCTION] Throwing error on first execution');
              throw new Error('Simulated failure at step 2');
            }
            
            return 'step2-done';
          });

          const result3 = await step.run('Step 3: Finalize', async () => {
            step3Executions++;
            console.log(`[FUNCTION] Step 3 executed (count: ${step3Executions})`);
            return 'step3-done';
          });

          return { result1, result2, result3 };
        }
      );

      client = new WorchflowClient<TestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [failingFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);

      console.log('[TEST] Sending event...');
      const executionId = await client.send({
        name: 'checkpoint-event',
        data: { value: 'test' },
      });
      console.log(`[TEST] Event sent: ${executionId}`);

      console.log('[TEST] Waiting for automatic retry to complete...');
      const { status, execution: completedExecution } = await waitForExecutionEvent(worcher, executionId, ctx.db, 20000);
      console.log('[TEST] Retry completed successfully');
      expect(status).toBe('completed');

      // Verify the execution completed after automatic retry
      expect(completedExecution.status).toBe('completed');
      expect(executionCount).toBe(2); // Should have executed twice (initial + 1 retry)
      expect(step1Executions).toBe(1); // Should NOT re-execute (checkpoint)
      expect(step2Executions).toBe(2); // Should re-execute (failed here)
      expect(step3Executions).toBe(1); // Should execute on retry

      expect(completedExecution.result).toEqual({
        result1: 'step1-done',
        result2: 'step2-done',
        result3: 'step3-done',
      });

      console.log('[TEST] Test passed!');
    });

    it('should not re-execute completed steps on retry', async () => {
      console.log('[TEST] Testing completed step preservation...');

      let step1Count = 0;
      let step2Count = 0;
      let step3Count = 0;

      const checkpointFunction = createFunction<TestEvents, 'resume-event'>(
        { id: 'resume-event', retries: 1 }, // Allow 1 retry
        async ({ event, step }) => {
          const s1 = await step.run('Step 1', async () => {
            step1Count++;
            console.log(`[FUNCTION] Step 1, execution count: ${step1Count}`);
            return 'result1';
          });

          const s2 = await step.run('Step 2', async () => {
            step2Count++;
            console.log(`[FUNCTION] Step 2, execution count: ${step2Count}`);
            
            if (step2Count === 1) {
              throw new Error('Fail on first attempt');
            }
            
            return 'result2';
          });

          const s3 = await step.run('Step 3', async () => {
            step3Count++;
            console.log(`[FUNCTION] Step 3, execution count: ${step3Count}`);
            return 'result3';
          });

          return { s1, s2, s3, step1Count, step2Count, step3Count };
        }
      );

      client = new WorchflowClient<TestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [checkpointFunction]
      );

      await startWorcher(worcher);

      const executionId = await client.send({
        name: 'resume-event',
        data: { steps: 3 },
      });

      console.log('[TEST] Now waiting for completion...');
      const { status, execution: completed } = await waitForExecutionEvent(worcher, executionId, ctx.db, 15000);
      expect(status).toBe('completed');

      expect(completed.result.step1Count).toBe(1); // Step 1 only executed once
      expect(completed.result.step2Count).toBe(2); // Step 2 executed twice (failed first time)
      expect(completed.result.step3Count).toBe(1); // Step 3 only executed once

      console.log('[TEST] Test passed!');
    });

    it('should handle dynamic step IDs correctly (no false cache hits)', async () => {
      console.log('[TEST] Testing dynamic step ID handling...');

      let totalStepExecutions = 0;

      const dynamicStepFunction = createFunction<TestEvents, 'resume-event'>(
        { id: 'resume-event' },
        async ({ event, step }) => {
          const results: string[] = [];
          
          for (let i = 0; i < event.data.steps; i++) {
            const result = await step.run(`Dynamic Step ${i}`, async () => {
              totalStepExecutions++;
              console.log(`[FUNCTION] Executing dynamic step ${i} (total executions: ${totalStepExecutions})`);
              return `result-${i}`;
            });
            results.push(result);
          }

          return { results, totalStepExecutions };
        }
      );

      client = new WorchflowClient<TestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [dynamicStepFunction]
      );

      await startWorcher(worcher);

      console.log('[TEST] Sending event with 5 dynamic steps...');
      const executionId = await client.send({
        name: 'resume-event',
        data: { steps: 5 },
      });

      const { status, execution: completed } = await waitForExecutionEvent(worcher, executionId, ctx.db, 10000);
      expect(status).toBe('completed');

      expect(completed.result.results).toHaveLength(5);
      expect(completed.result.results).toEqual([
        'result-0',
        'result-1',
        'result-2',
        'result-3',
        'result-4',
      ]);
      expect(totalStepExecutions).toBe(5); // Each step executed exactly once

      console.log('[TEST] Test passed!');
    });

    it('should handle step checkpoints across Redis and MongoDB', async () => {
      console.log('[TEST] Testing checkpoint persistence across Redis and MongoDB...');

      const checkpointFunction = createFunction<TestEvents, 'checkpoint-event'>(
        { id: 'checkpoint-event', retries: 0 }, // No automatic retries
        async ({ event, step }) => {
          await step.run('Step 1', async () => 'result1');
          await step.run('Step 2', async () => 'result2');
          await step.run('Step 3', async () => {
            throw new Error('Fail at step 3');
          });
        }
      );

      client = new WorchflowClient<TestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [checkpointFunction]
      );

      await startWorcher(worcher);

      const executionId = await client.send({
        name: 'checkpoint-event',
        data: { value: 'test' },
      });

      const { status } = await waitForExecutionEvent(worcher, executionId, ctx.db, 10000);
      expect(status).toBe('failed');

      console.log('[TEST] Checking Redis for step checkpoints...');
      const redisSteps = await ctx.redis.hgetall(`${ctx.queuePrefix}:steps:${executionId}`);
      console.log('[TEST] Redis steps:', Object.keys(redisSteps));

      console.log('[TEST] Checking MongoDB for step checkpoints...');
      const mongoSteps = await ctx.db.collection('steps').find({ executionId }).toArray();
      console.log('[TEST] MongoDB steps:', mongoSteps.map(s => s.name));

      // Both should have steps 1 and 2 checkpointed
      expect(Object.keys(redisSteps).length).toBeGreaterThanOrEqual(2);
      expect(mongoSteps.length).toBeGreaterThanOrEqual(2);

      // Verify both have the same step results
      const firstRedisKey = Object.keys(redisSteps)[0];
      const step1RedisWrapped = JSON.parse(redisSteps[firstRedisKey]);
      const step1Mongo = mongoSteps[0];

      // Redis stores wrapped result with cache flag
      expect(step1RedisWrapped).toMatchObject({ cached: true, value: 'result1' });
      expect(step1Mongo.status).toBe('completed');
      expect(step1Mongo.name).toBeTruthy(); // Has a name field

      console.log('[TEST] Test passed!');
    });

    it('should handle multiple retries with checkpoint persistence', async () => {
      console.log('[TEST] Testing multiple retries with checkpoints...');

      let attempts = 0;

      const multiRetryFunction = createFunction<TestEvents, 'checkpoint-event'>(
        { id: 'checkpoint-event', retries: 2 }, // Allow 2 retries (3 total attempts)
        async ({ event, step }) => {
          attempts++;
          console.log(`[FUNCTION] Attempt #${attempts}`);

          await step.run('Step 1: Always succeeds', async () => 'result1');
          
          await step.run('Step 2: Fails twice', async () => {
            if (attempts < 3) {
              throw new Error(`Attempt ${attempts} failed`);
            }
            return 'result2';
          });

          await step.run('Step 3: Should only run on 3rd attempt', async () => 'result3');

          return { attempts };
        }
      );

      client = new WorchflowClient<TestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [multiRetryFunction]
      );

      await startWorcher(worcher);

      const executionId = await client.send({
        name: 'checkpoint-event',
        data: { value: 'test' },
      });

      console.log('[TEST] Waiting for all automatic retries to complete...');
      const { status, execution: completed } = await waitForExecutionEvent(worcher, executionId, ctx.db, 20000);
      expect(status).toBe('completed');
      expect(attempts).toBe(3); // Function executed 3 times
      expect(completed.result.attempts).toBe(3);
      expect(completed.attemptCount).toBe(2); // 2 failures before success (attempt count increments on failure)

      console.log('[TEST] Test passed!');
    });
  });
});

