import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorchflowScheduler, Worcher, createFunction } from '../src';
import { createTestContext, sleep, TestContext, startWorcher } from './helpers/test-setup';

type ScheduledJobData = Record<string, never>;

type SchedulerTestEvents = {
  'scheduled-job': {
    data: ScheduledJobData;
  };
};

describe('Scheduler Tests', () => {
  let ctx: TestContext;
  let worcher: Worcher;
  let scheduler: WorchflowScheduler<SchedulerTestEvents>;

  beforeEach(async () => {
    console.log('[TEST] Setting up test context...');
    ctx = await createTestContext();
    console.log(`[TEST] Test context created with prefix: ${ctx.queuePrefix}`);
  });

  afterEach(async () => {
    console.log('[TEST] Cleaning up...');
    if (scheduler) {
      console.log('[TEST] Stopping scheduler...');
      await scheduler.stop();
      console.log('[TEST] Scheduler stopped');
    }
    if (worcher) {
      console.log('[TEST] Stopping worcher...');
      await worcher.stop();
      console.log('[TEST] Worcher stopped');
    }
    await ctx.cleanup();
    console.log('[TEST] Cleanup complete');
  });

  describe('Scheduler Timing', () => {
    it('should execute scheduled function every 10 seconds with 2s latency tolerance', async () => {
      console.log('[TEST] Creating scheduled function with 10-second interval...');
      
      const executionTimes: number[] = [];
      
      const scheduledJob = createFunction<SchedulerTestEvents, 'scheduled-job'>(
        { id: 'scheduled-job', cron: '*/10 * * * * *' },
        async ({ step }) => {
          const timestamp = await step.run('Record execution time', async () => {
            const now = Date.now();
            console.log(`[FUNCTION] Executed at ${new Date(now).toISOString()}`);
            return now;
          });

          return { executedAt: timestamp };
        }
      );

      console.log('[TEST] Creating worcher...');
      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [scheduledJob]
      );

      console.log('[TEST] Creating scheduler...');
      scheduler = new WorchflowScheduler(
        {
          redis: ctx.redis,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          logging: true,
          leaderElection: false,
        },
        [scheduledJob]
      );

      console.log('[TEST] Starting worcher...');
      await startWorcher(worcher);
      console.log('[TEST] Worcher started');

      console.log('[TEST] Setting up event listeners...');
      const executionPromise = new Promise<void>((resolve) => {
        scheduler.on('schedule:triggered', ({ timestamp }) => {
          executionTimes.push(timestamp);
          console.log(`[TEST] Execution #${executionTimes.length} triggered at ${new Date(timestamp).toISOString()}`);
          
          if (executionTimes.length === 2) {
            resolve();
          }
        });
      });

      console.log('[TEST] Starting scheduler...');
      await scheduler.start();
      console.log('[TEST] Scheduler started, waiting for 2 executions...');

      await executionPromise;

      console.log('[TEST] Two executions completed, validating timing...');
      expect(executionTimes).toHaveLength(2);

      const interval = executionTimes[1] - executionTimes[0];
      const expectedInterval = 10000;
      const latencyTolerance = 2000;
      const drift = Math.abs(interval - expectedInterval);

      console.log(`[TEST] First execution: ${new Date(executionTimes[0]).toISOString()}`);
      console.log(`[TEST] Second execution: ${new Date(executionTimes[1]).toISOString()}`);
      console.log(`[TEST] Interval: ${interval}ms (expected: ${expectedInterval}ms)`);
      console.log(`[TEST] Drift: ${drift}ms (tolerance: ${latencyTolerance}ms)`);

      expect(drift).toBeLessThanOrEqual(latencyTolerance);
      console.log('[TEST] ✅ Test passed! Scheduler executed within latency tolerance');
    }, 30000);
  });

  describe('Scheduler Lifecycle', () => {
    it('should register scheduled functions correctly', async () => {
      console.log('[TEST] Testing scheduler registration...');
      
      const scheduledJob = createFunction<SchedulerTestEvents, 'scheduled-job'>(
        { id: 'scheduled-job', cron: '*/30 * * * * *' },
        async ({ step }) => {
          await step.run('Test step', async () => {
            return { message: 'test' };
          });
        }
      );

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [scheduledJob]
      );

      scheduler = new WorchflowScheduler(
        {
          redis: ctx.redis,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          logging: true,
          leaderElection: false,
        },
        [scheduledJob]
      );

      await startWorcher(worcher);

      const registrationPromise = new Promise<void>((resolve) => {
        scheduler.on('schedule:registered', ({ functionId, cron }) => {
          console.log(`[TEST] Schedule registered: ${functionId} with cron: ${cron}`);
          expect(functionId).toBe('scheduled-job');
          expect(cron).toBe('*/30 * * * * *');
          resolve();
        });
      });

      await scheduler.start();
      await registrationPromise;

      const scheduledFunctions = scheduler.getScheduledFunctions();
      expect(scheduledFunctions).toHaveLength(1);
      expect(scheduledFunctions[0].id).toBe('scheduled-job');
      expect(scheduledFunctions[0].cron).toBe('*/30 * * * * *');
      expect(scheduledFunctions[0].nextRun).toBeInstanceOf(Date);

      console.log('[TEST] ✅ Test passed! Scheduler registered function correctly');
    });

    it('should stop scheduler cleanly', async () => {
      console.log('[TEST] Testing scheduler stop...');
      
      const scheduledJob = createFunction<SchedulerTestEvents, 'scheduled-job'>(
        { id: 'scheduled-job', cron: '*/5 * * * * *' },
        async ({ step }) => {
          await step.run('Test step', async () => {
            return { message: 'test' };
          });
        }
      );

      worcher = new Worcher(
        {
          redis: ctx.redisWorker,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          concurrency: 1,
          logging: true,
        },
        [scheduledJob]
      );

      scheduler = new WorchflowScheduler(
        {
          redis: ctx.redis,
          db: ctx.db,
          queuePrefix: ctx.queuePrefix,
          logging: true,
          leaderElection: false,
        },
        [scheduledJob]
      );

      await startWorcher(worcher);

      const stoppedPromise = new Promise<void>((resolve) => {
        scheduler.on('stopped', () => {
          console.log('[TEST] Scheduler stopped event received');
          resolve();
        });
      });

      await scheduler.start();
      console.log('[TEST] Scheduler started');

      await sleep(1000);

      console.log('[TEST] Stopping scheduler...');
      await scheduler.stop();
      
      await stoppedPromise;

      expect(scheduler.isLeaderNode()).toBe(false);
      console.log('[TEST] ✅ Test passed! Scheduler stopped cleanly');
    });
  });
});

