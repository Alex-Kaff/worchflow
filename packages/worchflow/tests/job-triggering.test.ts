import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorchflowClient, Worcher } from '../src';
import { 
  createTestContext, 
  waitForExecution, 
  waitForExecutionEvent, 
  getSteps, 
  sleep, 
  TestContext, 
  startWorcher 
} from './helpers/test-setup';
import {
  createParentJobFunction,
  childJobFunction,
  createChainStep1Function,
  createChainStep2Function,
  chainStep3Function,
  createParallelTriggerFunction,
  parallelChildAFunction,
  parallelChildBFunction,
  parallelChildCFunction,
  createConditionalParentFunction,
  conditionalChildFunction,
  TriggerTestEvents,
} from './helpers/test-functions-triggering';

describe('Job Triggering Tests', () => {
  let ctx: TestContext;
  let client: WorchflowClient<TriggerTestEvents>;
  let worcher: Worcher;

  beforeEach(async () => {
    console.log('[TEST] Setting up test context for job triggering...');
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

  describe('1. Simple Parent-Child Job Triggering', () => {
    it('should trigger child job from parent job', async () => {
      console.log('[TEST] Setting up parent-child job test...');
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const parentJobFunction = createParentJobFunction(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 2,
          logging: true,
        },
        [parentJobFunction, childJobFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending parent job...');
      const parentId = await client.send({
        name: 'parent-job',
        data: {
          message: 'hello world',
          shouldTrigger: true,
        },
      });
      console.log(`[TEST] Parent job sent with ID: ${parentId}`);

      console.log('[TEST] Waiting for parent job to complete...');
      const parentExecution = await waitForExecution(ctx.db, parentId, 'completed', 10000);
      console.log('[TEST] Parent job completed:', parentExecution.result);

      expect(parentExecution.status).toBe('completed');
      expect(parentExecution.result.childTriggered).toBe(true);
      expect(parentExecution.result.processed).toBe('HELLO WORLD');
      expect(parentExecution.result.childExecutionId).toBeTruthy();

      const childId = parentExecution.result.childExecutionId;
      console.log(`[TEST] Waiting for child job ${childId} to complete...`);
      const childExecution = await waitForExecution(ctx.db, childId, 'completed', 10000);
      console.log('[TEST] Child job completed:', childExecution.result);

      expect(childExecution.status).toBe('completed');
      expect(childExecution.result.childData).toBe('Child processed: HELLO WORLD');
      expect(childExecution.result.parentId).toBe('parent-execution');

      console.log('[TEST] Checking steps for parent...');
      const parentSteps = await getSteps(ctx.db, parentId);
      console.log(`[TEST] Parent has ${parentSteps.length} steps`);
      expect(parentSteps).toHaveLength(2);

      console.log('[TEST] Checking steps for child...');
      const childSteps = await getSteps(ctx.db, childId);
      console.log(`[TEST] Child has ${childSteps.length} steps`);
      expect(childSteps).toHaveLength(1);

      console.log('[TEST] Test passed!');
    });

    it('should not trigger child job when condition is false', async () => {
      console.log('[TEST] Setting up conditional parent test (no trigger)...');
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const parentJobFunction = createParentJobFunction(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [parentJobFunction, childJobFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending parent job (shouldTrigger=false)...');
      const parentId = await client.send({
        name: 'parent-job',
        data: {
          message: 'no child',
          shouldTrigger: false,
        },
      });
      console.log(`[TEST] Parent job sent with ID: ${parentId}`);

      console.log('[TEST] Waiting for parent job to complete...');
      const parentExecution = await waitForExecution(ctx.db, parentId, 'completed', 5000);
      console.log('[TEST] Parent job completed:', parentExecution.result);

      expect(parentExecution.status).toBe('completed');
      expect(parentExecution.result.childTriggered).toBe(false);
      expect(parentExecution.result.childExecutionId).toBeUndefined();

      console.log('[TEST] Waiting to ensure no child job was created...');
      await sleep(1000);

      const allExecutions = await ctx.db.collection('executions').find({}).toArray();
      console.log(`[TEST] Total executions in DB: ${allExecutions.length}`);
      expect(allExecutions).toHaveLength(1);

      console.log('[TEST] Test passed!');
    });
  });

  describe('2. Chained Job Execution', () => {
    it('should execute a chain of 3 jobs in sequence', async () => {
      console.log('[TEST] Setting up 3-step chain test...');
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const chainStep1Function = createChainStep1Function(client);
      const chainStep2Function = createChainStep2Function(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 3,
          logging: true,
        },
        [chainStep1Function, chainStep2Function, chainStep3Function]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending chain step 1...');
      const step1Id = await client.send({
        name: 'chain-step-1',
        data: {
          step: 1,
          value: 'START',
        },
      });
      console.log(`[TEST] Chain step 1 sent with ID: ${step1Id}`);

      console.log('[TEST] Waiting for step 1...');
      const exec1 = await waitForExecution(ctx.db, step1Id, 'completed', 10000);
      console.log('[TEST] Step 1 completed:', exec1.result);
      expect(exec1.result.value).toBe('START-STEP1');
      expect(exec1.result.nextExecutionId).toBeTruthy();

      const step2Id = exec1.result.nextExecutionId;
      console.log(`[TEST] Waiting for step 2 (${step2Id})...`);
      const exec2 = await waitForExecution(ctx.db, step2Id, 'completed', 10000);
      console.log('[TEST] Step 2 completed:', exec2.result);
      expect(exec2.result.value).toBe('START-STEP1-STEP2');
      expect(exec2.result.nextExecutionId).toBeTruthy();

      const step3Id = exec2.result.nextExecutionId;
      console.log(`[TEST] Waiting for step 3 (${step3Id})...`);
      const exec3 = await waitForExecution(ctx.db, step3Id, 'completed', 10000);
      console.log('[TEST] Step 3 completed:', exec3.result);
      expect(exec3.result.value).toBe('START-STEP1-STEP2-STEP3');
      expect(exec3.result.final).toBe(true);

      console.log('[TEST] Verifying all 3 executions in database...');
      const allExecutions = await ctx.db.collection('executions')
        .find({ status: 'completed' })
        .toArray();
      console.log(`[TEST] Total completed executions: ${allExecutions.length}`);
      expect(allExecutions).toHaveLength(3);

      console.log('[TEST] Test passed!');
    });
  });

  describe('3. Parallel Job Triggering', () => {
    it('should trigger multiple child jobs in parallel', async () => {
      console.log('[TEST] Setting up parallel trigger test...');
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const parallelTriggerFunction = createParallelTriggerFunction(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 4,
          logging: true,
        },
        [
          parallelTriggerFunction, 
          parallelChildAFunction, 
          parallelChildBFunction, 
          parallelChildCFunction
        ]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending parallel trigger job...');
      const parentId = await client.send({
        name: 'parallel-trigger',
        data: {
          count: 3,
        },
      });
      console.log(`[TEST] Parallel trigger sent with ID: ${parentId}`);

      console.log('[TEST] Waiting for parent to complete...');
      const parentExec = await waitForExecution(ctx.db, parentId, 'completed', 10000);
      console.log('[TEST] Parent completed:', parentExec.result);

      expect(parentExec.result.childrenTriggered).toBe(3);
      expect(parentExec.result.childExecutionIds).toHaveLength(3);

      const childIds = parentExec.result.childExecutionIds;
      console.log(`[TEST] Waiting for ${childIds.length} child jobs to complete...`);

      const childExecutions = await Promise.all(
        childIds.map((id: string) => waitForExecution(ctx.db, id, 'completed', 10000))
      );
      console.log(`[TEST] All ${childExecutions.length} children completed`);

      expect(childExecutions).toHaveLength(3);
      expect(childExecutions[0].result.child).toBe('A');
      expect(childExecutions[1].result.child).toBe('B');
      expect(childExecutions[2].result.child).toBe('C');

      childExecutions.forEach((exec, index) => {
        expect(exec.status).toBe('completed');
        expect(exec.result.parentId).toBe('parallel-parent');
        console.log(`[TEST] Child ${index + 1} (${exec.result.child}):`, exec.result.result);
      });

      console.log('[TEST] Verifying all 4 executions in database...');
      const allExecutions = await ctx.db.collection('executions')
        .find({ status: 'completed' })
        .toArray();
      console.log(`[TEST] Total completed executions: ${allExecutions.length}`);
      expect(allExecutions).toHaveLength(4);

      console.log('[TEST] Test passed!');
    });
  });

  describe('4. Conditional Job Triggering', () => {
    it('should trigger child job when condition is met', async () => {
      console.log('[TEST] Setting up conditional trigger test (threshold met)...');
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const conditionalParentFunction = createConditionalParentFunction(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 2,
          logging: true,
        },
        [conditionalParentFunction, conditionalChildFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending conditional parent (threshold=75)...');
      const parentId = await client.send({
        name: 'conditional-parent',
        data: {
          threshold: 75,
        },
      });
      console.log(`[TEST] Conditional parent sent with ID: ${parentId}`);

      console.log('[TEST] Waiting for parent to complete...');
      const parentExec = await waitForExecution(ctx.db, parentId, 'completed', 10000);
      console.log('[TEST] Parent completed:', parentExec.result);

      expect(parentExec.status).toBe('completed');
      expect(parentExec.result.shouldTrigger).toBe(true);
      expect(parentExec.result.childExecutionId).toBeTruthy();

      const childId = parentExec.result.childExecutionId;
      console.log(`[TEST] Waiting for conditional child (${childId})...`);
      const childExec = await waitForExecution(ctx.db, childId, 'completed', 10000);
      console.log('[TEST] Child completed:', childExec.result);

      expect(childExec.status).toBe('completed');
      expect(childExec.result.message).toContain('Threshold 75 exceeded');

      console.log('[TEST] Test passed!');
    });

    it('should not trigger child job when condition is not met', async () => {
      console.log('[TEST] Setting up conditional trigger test (threshold not met)...');
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const conditionalParentFunction = createConditionalParentFunction(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 2,
          logging: true,
        },
        [conditionalParentFunction, conditionalChildFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending conditional parent (threshold=30)...');
      const parentId = await client.send({
        name: 'conditional-parent',
        data: {
          threshold: 30,
        },
      });
      console.log(`[TEST] Conditional parent sent with ID: ${parentId}`);

      console.log('[TEST] Waiting for parent to complete...');
      const parentExec = await waitForExecution(ctx.db, parentId, 'completed', 5000);
      console.log('[TEST] Parent completed:', parentExec.result);

      expect(parentExec.status).toBe('completed');
      expect(parentExec.result.shouldTrigger).toBe(false);
      expect(parentExec.result.childExecutionId).toBeUndefined();
      expect(parentExec.result.message).toBe('Threshold not met, no child triggered');

      console.log('[TEST] Waiting to ensure no child job was created...');
      await sleep(1000);

      const allExecutions = await ctx.db.collection('executions').find({}).toArray();
      console.log(`[TEST] Total executions in DB: ${allExecutions.length}`);
      expect(allExecutions).toHaveLength(1);

      console.log('[TEST] Test passed!');
    });
  });

  describe('5. Complex Triggering Scenarios', () => {
    it('should handle mixed chain and parallel triggering', async () => {
      console.log('[TEST] Setting up complex mixed triggering test...');
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const parentJobFunction = createParentJobFunction(client);
      const parallelTriggerFunction = createParallelTriggerFunction(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 5,
          logging: true,
        },
        [
          parentJobFunction,
          childJobFunction,
          parallelTriggerFunction,
          parallelChildAFunction,
          parallelChildBFunction,
          parallelChildCFunction,
        ]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending parent job and parallel trigger simultaneously...');
      const [parentId, parallelId] = await Promise.all([
        client.send({
          name: 'parent-job',
          data: {
            message: 'complex test',
            shouldTrigger: true,
          },
        }),
        client.send({
          name: 'parallel-trigger',
          data: {
            count: 3,
          },
        }),
      ]);
      console.log(`[TEST] Sent parent (${parentId}) and parallel (${parallelId})`);

      console.log('[TEST] Waiting for both to complete...');
      const [parentExec, parallelExec] = await Promise.all([
        waitForExecution(ctx.db, parentId, 'completed', 15000),
        waitForExecution(ctx.db, parallelId, 'completed', 15000),
      ]);
      console.log('[TEST] Both initial jobs completed');

      expect(parentExec.result.childTriggered).toBe(true);
      expect(parallelExec.result.childrenTriggered).toBe(3);

      const childId = parentExec.result.childExecutionId;
      const parallelChildIds = parallelExec.result.childExecutionIds;

      console.log('[TEST] Waiting for all triggered children...');
      const allChildren = await Promise.all([
        waitForExecution(ctx.db, childId, 'completed', 10000),
        ...parallelChildIds.map((id: string) => 
          waitForExecution(ctx.db, id, 'completed', 10000)
        ),
      ]);
      console.log(`[TEST] All ${allChildren.length} children completed`);

      expect(allChildren).toHaveLength(4);

      console.log('[TEST] Verifying total executions...');
      const totalExecutions = await ctx.db.collection('executions')
        .find({ status: 'completed' })
        .toArray();
      console.log(`[TEST] Total completed executions: ${totalExecutions.length}`);
      expect(totalExecutions).toHaveLength(6);

      console.log('[TEST] Test passed!');
    });

    it('should handle rapid sequential triggering', async () => {
      console.log('[TEST] Setting up rapid sequential triggering test...');
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const parentJobFunction = createParentJobFunction(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 3,
          logging: true,
        },
        [parentJobFunction, childJobFunction]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending 5 parent jobs rapidly...');
      const parentIds = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          client.send({
            name: 'parent-job',
            data: {
              message: `rapid-${i}`,
              shouldTrigger: true,
            },
          })
        )
      );
      console.log(`[TEST] Sent ${parentIds.length} parent jobs`);

      console.log('[TEST] Waiting for all parents to complete...');
      const parentExecutions = await Promise.all(
        parentIds.map(id => waitForExecution(ctx.db, id, 'completed', 15000))
      );
      console.log(`[TEST] All ${parentExecutions.length} parents completed`);

      const childIds = parentExecutions.map(exec => exec.result.childExecutionId);
      
      console.log('[TEST] Waiting for all children to complete...');
      const childExecutions = await Promise.all(
        childIds.map(id => waitForExecution(ctx.db, id, 'completed', 15000))
      );
      console.log(`[TEST] All ${childExecutions.length} children completed`);

      expect(childExecutions).toHaveLength(5);
      childExecutions.forEach(exec => {
        expect(exec.status).toBe('completed');
      });

      console.log('[TEST] Verifying total executions...');
      const totalExecutions = await ctx.db.collection('executions')
        .find({ status: 'completed' })
        .toArray();
      console.log(`[TEST] Total completed executions: ${totalExecutions.length}`);
      expect(totalExecutions).toHaveLength(10);

      console.log('[TEST] Test passed!');
    });
  });

  describe('6. Event Tracking for Triggered Jobs', () => {
    it('should emit events for both parent and triggered child jobs', async () => {
      console.log('[TEST] Setting up event tracking test...');
      const events: Array<{ type: string; data: any }> = [];
      
      client = new WorchflowClient<TriggerTestEvents>({
        redis: ctx.redis,
        db: ctx.db,
        queuePrefix: ctx.queuePrefix,
      });

      const parentJobFunction = createParentJobFunction(client);

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 2,
          logging: true,
        },
        [parentJobFunction, childJobFunction]
      );

      worcher.on('execution:start', (data) => {
        console.log('[EVENT] execution:start', data);
        events.push({ type: 'start', data });
      });

      worcher.on('execution:complete', (data) => {
        console.log('[EVENT] execution:complete', data);
        events.push({ type: 'complete', data });
      });

      worcher.on('execution:updated', (data) => {
        console.log('[EVENT] execution:updated', data);
        events.push({ type: 'updated', data });
      });

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Sending parent job...');
      const parentId = await client.send({
        name: 'parent-job',
        data: {
          message: 'event tracking',
          shouldTrigger: true,
        },
      });
      console.log(`[TEST] Parent job sent with ID: ${parentId}`);

      console.log('[TEST] Waiting for parent to complete...');
      const parentExec = await waitForExecution(ctx.db, parentId, 'completed', 10000);
      const childId = parentExec.result.childExecutionId;

      console.log('[TEST] Waiting for child to complete...');
      await waitForExecution(ctx.db, childId, 'completed', 10000);

      console.log('[TEST] Waiting for events to settle...');
      await sleep(500);

      console.log(`[TEST] Received ${events.length} total events`);
      const startEvents = events.filter(e => e.type === 'start');
      const completeEvents = events.filter(e => e.type === 'complete');
      const updatedEvents = events.filter(e => e.type === 'updated');

      console.log(`[TEST] Start: ${startEvents.length}, Complete: ${completeEvents.length}, Updated: ${updatedEvents.length}`);
      
      expect(startEvents.length).toBeGreaterThanOrEqual(2);
      expect(completeEvents.length).toBeGreaterThanOrEqual(2);
      expect(updatedEvents.length).toBeGreaterThanOrEqual(2);

      const parentStartEvent = startEvents.find(e => e.data.executionId === parentId);
      const childStartEvent = startEvents.find(e => e.data.executionId === childId);
      
      expect(parentStartEvent).toBeTruthy();
      expect(childStartEvent).toBeTruthy();

      console.log('[TEST] Test passed!');
    });
  });
});

