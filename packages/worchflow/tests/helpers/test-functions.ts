import { createFunction } from '../../src/index';

export type SimpleEventData = {
  value: string;
};

export type CounterEventData = {
  count: number;
};

export type ErrorEventData = {
  shouldFail: boolean;
  failAt?: number;
};

export type TestEvents = {
  'simple-event': { data: SimpleEventData };
  'counter-event': { data: CounterEventData };
  'error-event': { data: ErrorEventData };
  'multi-step-event': { data: { steps: number } };
  'long-running-event': { data: { durationMs: number } };
};

export const simpleFunction = createFunction<TestEvents, 'simple-event'>(
  { id: 'simple-event' },
  async ({ event, step }) => {
    const result = await step.run('Process value', async () => {
      return { processed: event.data.value.toUpperCase() };
    });
    
    return result;
  }
);

export const counterFunction = createFunction<TestEvents, 'counter-event'>(
  { id: 'counter-event' },
  async ({ event, step }) => {
    const step1 = await step.run('Add 10', async () => {
      return event.data.count + 10;
    });
    
    const step2 = await step.run('Multiply by 2', async () => {
      return step1 * 2;
    });
    
    const step3 = await step.run('Subtract 5', async () => {
      return step2 - 5;
    });
    
    return { result: step3 };
  }
);

export const errorFunction = createFunction<TestEvents, 'error-event'>(
  { id: 'error-event' },
  async ({ event, step }) => {
    const step1 = await step.run('Step 1', async () => {
      if (event.data.shouldFail && event.data.failAt === 1) {
        throw new Error('Failed at step 1');
      }
      return 'step1-complete';
    });
    
    const step2 = await step.run('Step 2', async () => {
      if (event.data.shouldFail && event.data.failAt === 2) {
        throw new Error('Failed at step 2');
      }
      return 'step2-complete';
    });
    
    const step3 = await step.run('Step 3', async () => {
      if (event.data.shouldFail && event.data.failAt === 3) {
        throw new Error('Failed at step 3');
      }
      return 'step3-complete';
    });
    
    return { step1, step2, step3 };
  }
);

export const multiStepFunction = createFunction<TestEvents, 'multi-step-event'>(
  { id: 'multi-step-event' },
  async ({ event, step }) => {
    const results: string[] = [];
    
    for (let i = 0; i < event.data.steps; i++) {
      const result = await step.run(`Step ${i + 1}`, async () => {
        return `step-${i + 1}-complete`;
      });
      results.push(result);
    }
    
    return { results };
  }
);

export const longRunningFunction = createFunction<TestEvents, 'long-running-event'>(
  { id: 'long-running-event' },
  async ({ event, step }) => {
    const start = await step.run('Start', async () => {
      return Date.now();
    });
    
    const work = await step.run('Long work', async () => {
      await new Promise(resolve => setTimeout(resolve, event.data.durationMs));
      return 'work-complete';
    });
    
    const end = await step.run('End', async () => {
      return Date.now();
    });
    
    return { start, work, end, duration: end - start };
  }
);

