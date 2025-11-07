import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorchflowClient, Worcher, createFunction } from '../src';
import { createTestContext, waitForExecution, getSteps, sleep, TestContext, startWorcher } from './helpers/test-setup';
import {
  simpleFunction,
  counterFunction,
  multiStepFunction,
  longRunningFunction,
  TestEvents,
} from './helpers/test-functions';

describe('Basic Functionality Tests', () => {
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

  describe('1.1 Happy Path Tests', () => {
    it('should execute single step workflow successfully', async () => {
      console.log('[TEST] Creating client and worcher...');
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
        [simpleFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending event...');
      const executionId = await client.send({
        name: 'simple-event',
        data: { value: 'hello' },
      });
      console.log(`[TEST] Event sent with executionId: ${executionId}`);

      expect(executionId).toBeTruthy();
      expect(typeof executionId).toBe('string');

      console.log('[TEST] Waiting for execution to complete...');
      const execution = await waitForExecution(ctx.db, executionId, 'completed');
      console.log(`[TEST] Execution completed with status: ${execution.status}`);

      expect(execution.status).toBe('completed');
      expect(execution.result).toEqual({ processed: 'HELLO' });
      expect(execution.eventName).toBe('simple-event');
      expect(execution.eventData).toBe(JSON.stringify({ value: 'hello' }));

      console.log('[TEST] Checking steps...');
      const steps = await getSteps(ctx.db, executionId);
      console.log(`[TEST] Found ${steps.length} steps`);
      expect(steps).toHaveLength(1);
      expect(steps[0].result).toEqual({ processed: 'HELLO' });
      console.log('[TEST] Test passed!');
    });

    it('should execute multiple steps in sequence', async () => {
      console.log('[TEST] Creating client and worcher for multi-step...');
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
        [counterFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending counter event...');
      const executionId = await client.send({
        name: 'counter-event',
        data: { count: 5 },
      });
      console.log(`[TEST] Counter event sent with executionId: ${executionId}`);

      console.log('[TEST] Waiting for execution...');
      const execution = await waitForExecution(ctx.db, executionId, 'completed');
      console.log(`[TEST] Execution completed with result:`, execution.result);

      expect(execution.status).toBe('completed');
      expect(execution.result).toEqual({ result: 25 });

      console.log('[TEST] Checking steps...');
      const steps = await getSteps(ctx.db, executionId);
      console.log(`[TEST] Found ${steps.length} steps with results:`, steps.map(s => s.result));
      expect(steps).toHaveLength(3);
      expect(steps[0].result).toBe(15);
      expect(steps[1].result).toBe(30);
      expect(steps[2].result).toBe(25);
      console.log('[TEST] Test passed!');
    });

    it('should handle multiple concurrent executions', async () => {
      console.log('[TEST] Setting up concurrent execution test...');
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
          concurrency: 3,
          logging: true,
        },
        [simpleFunction]
      );

      console.log('[TEST] Starting worcher with concurrency 3...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending 3 events concurrently...');
      const executionIds = await Promise.all([
        client.send({ name: 'simple-event', data: { value: 'test1' } }),
        client.send({ name: 'simple-event', data: { value: 'test2' } }),
        client.send({ name: 'simple-event', data: { value: 'test3' } }),
      ]);
      console.log(`[TEST] Sent 3 events with IDs:`, executionIds);

      expect(executionIds).toHaveLength(3);

      console.log('[TEST] Waiting for all executions to complete...');
      const executions = await Promise.all(
        executionIds.map(id => waitForExecution(ctx.db, id, 'completed', 30000))
      );
      console.log(`[TEST] All executions completed`);

      expect(executions).toHaveLength(3);
      expect(executions[0].result).toEqual({ processed: 'TEST1' });
      expect(executions[1].result).toEqual({ processed: 'TEST2' });
      expect(executions[2].result).toEqual({ processed: 'TEST3' });
      console.log('[TEST] Test passed!');
    });

    it('should execute different event types correctly', async () => {
      console.log('[TEST] Setting up different event types test...');
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
          concurrency: 2,
          logging: true,
        },
        [simpleFunction, counterFunction]
      );

      console.log('[TEST] Starting worcher with 2 function types...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending different event types...');
      const [exec1Id, exec2Id] = await Promise.all([
        client.send({ name: 'simple-event', data: { value: 'hello' } }),
        client.send({ name: 'counter-event', data: { count: 10 } }),
      ]);
      console.log(`[TEST] Sent events: simple=${exec1Id}, counter=${exec2Id}`);

      console.log('[TEST] Waiting for both executions...');
      const [exec1, exec2] = await Promise.all([
        waitForExecution(ctx.db, exec1Id, 'completed', 10000),
        waitForExecution(ctx.db, exec2Id, 'completed', 10000),
      ]);
      console.log(`[TEST] Both executions completed`);

      expect(exec1.eventName).toBe('simple-event');
      expect(exec1.result).toEqual({ processed: 'HELLO' });

      expect(exec2.eventName).toBe('counter-event');
      expect(exec2.result).toEqual({ result: 35 });
      console.log('[TEST] Test passed!');
    });

    it('should persist return values correctly', async () => {
      console.log('[TEST] Testing persistence...');
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
        [counterFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending event...');
      const executionId = await client.send({
        name: 'counter-event',
        data: { count: 7 },
      });
      console.log(`[TEST] Event sent: ${executionId}`);

      console.log('[TEST] Waiting for execution...');
      await waitForExecution(ctx.db, executionId, 'completed');
      console.log('[TEST] Execution completed');

      console.log('[TEST] Allowing time for Redis update propagation...');
      await sleep(200);

      console.log('[TEST] Checking MongoDB...');
      const mongoExecution = await ctx.db.collection('executions').findOne({ id: executionId });
      console.log('[TEST] MongoDB execution:', mongoExecution);
      expect(mongoExecution).toBeTruthy();
      expect(mongoExecution!.result).toEqual({ result: 29 });
      expect(mongoExecution!.status).toBe('completed');
      
      console.log('[TEST] Test passed!');
    });

    it('should not re-execute completed steps', async () => {
      console.log('[TEST] Testing step re-execution prevention...');
      let step1ExecutionCount = 0;
      let step2ExecutionCount = 0;

      const testFunction = createFunction<TestEvents, 'simple-event'>(
        { id: 'simple-event' },
        async ({ event, step }) => {
          const step1Result = await step.run('Step 1', async () => {
            step1ExecutionCount++;
            console.log(`[FUNCTION] Step 1 executed, count: ${step1ExecutionCount}`);
            return 'step1';
          });

          const step2Result = await step.run('Step 2', async () => {
            step2ExecutionCount++;
            console.log(`[FUNCTION] Step 2 executed, count: ${step2ExecutionCount}`);
            return 'step2';
          });

          return { step1Result, step2Result, step1ExecutionCount, step2ExecutionCount };
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
        [testFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending event...');
      const executionId = await client.send({
        name: 'simple-event',
        data: { value: 'test' },
      });
      console.log(`[TEST] Event sent: ${executionId}`);

      console.log('[TEST] Waiting for execution...');
      const execution = await waitForExecution(ctx.db, executionId, 'completed');
      console.log(`[TEST] Execution completed, step1Count=${step1ExecutionCount}, step2Count=${step2ExecutionCount}`);

      expect(step1ExecutionCount).toBe(1);
      expect(step2ExecutionCount).toBe(1);
      expect(execution.result.step1ExecutionCount).toBe(1);
      expect(execution.result.step2ExecutionCount).toBe(1);
      console.log('[TEST] Test passed!');
    });

    it('should handle many steps in a single execution', async () => {
      console.log('[TEST] Testing many steps execution...');
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
        [multiStepFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending multi-step event (10 steps)...');
      const executionId = await client.send({
        name: 'multi-step-event',
        data: { steps: 10 },
      });
      console.log(`[TEST] Event sent: ${executionId}`);

      console.log('[TEST] Waiting for execution (10s timeout)...');
      const execution = await waitForExecution(ctx.db, executionId, 'completed', 10000);
      console.log(`[TEST] Execution completed with ${execution.result.results?.length || 0} results`);

      expect(execution.status).toBe('completed');
      expect(execution.result.results).toHaveLength(10);

      console.log('[TEST] Checking steps...');
      const steps = await getSteps(ctx.db, executionId);
      console.log(`[TEST] Found ${steps.length} steps`);
      expect(steps).toHaveLength(10);
      console.log('[TEST] Test passed!');
    });

    it('should handle custom execution IDs', async () => {
      console.log('[TEST] Testing custom execution IDs...');
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
        [simpleFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      const customId = 'custom-execution-id-123';
      console.log(`[TEST] Sending event with custom ID: ${customId}`);
      const executionId = await client.send({
        name: 'simple-event',
        data: { value: 'custom' },
        id: customId,
      });
      console.log(`[TEST] Returned execution ID: ${executionId}`);

      expect(executionId).toBe(customId);

      console.log('[TEST] Waiting for execution...');
      const execution = await waitForExecution(ctx.db, customId, 'completed');
      console.log(`[TEST] Execution completed with ID: ${execution.id}`);
      expect(execution.id).toBe(customId);
      console.log('[TEST] Test passed!');
    });

    it('should emit lifecycle events correctly', async () => {
      console.log('[TEST] Testing lifecycle events...');
      const events: Array<{ type: string; data: any }> = [];

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
        [simpleFunction]
      );

      worcher.on('execution:start', (data) => {
        console.log('[EVENT] execution:start', data);
        events.push({ type: 'start', data });
      });

      worcher.on('execution:complete', (data) => {
        console.log('[EVENT] execution:complete', data);
        events.push({ type: 'complete', data });
      });

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending event...');
      const executionId = await client.send({
        name: 'simple-event',
        data: { value: 'test' },
      });
      console.log(`[TEST] Event sent: ${executionId}`);

      console.log('[TEST] Waiting for execution...');
      await waitForExecution(ctx.db, executionId, 'completed');
      console.log('[TEST] Execution completed');

      console.log('[TEST] Waiting for events to propagate...');
      await sleep(500);

      console.log(`[TEST] Received ${events.length} events:`, events.map(e => e.type));
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('start');
      expect(events[0].data.executionId).toBe(executionId);
      expect(events[0].data.eventName).toBe('simple-event');

      expect(events[1].type).toBe('complete');
      expect(events[1].data.executionId).toBe(executionId);
      expect(events[1].data.result).toEqual({ processed: 'TEST' });
      console.log('[TEST] Test passed!');
    });
  });
});

