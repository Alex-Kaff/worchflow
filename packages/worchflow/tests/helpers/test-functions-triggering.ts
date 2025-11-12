import { createFunction, WorchflowClient } from '../../src/index';

export type TriggerEventData = {
  message: string;
  shouldTrigger?: boolean;
};

export type ChainStepData = {
  step: number;
  value: string;
};

export type ParallelTriggerData = {
  count: number;
};

export type ChildJobData = {
  parentId: string;
  data: string;
};

export type ConditionalTriggerData = {
  threshold: number;
};

export type TriggerTestEvents = {
  'parent-job': { data: TriggerEventData };
  'child-job': { data: ChildJobData };
  'chain-step-1': { data: ChainStepData };
  'chain-step-2': { data: ChainStepData };
  'chain-step-3': { data: ChainStepData };
  'parallel-trigger': { data: ParallelTriggerData };
  'parallel-child-a': { data: ChildJobData };
  'parallel-child-b': { data: ChildJobData };
  'parallel-child-c': { data: ChildJobData };
  'conditional-parent': { data: ConditionalTriggerData };
  'conditional-child': { data: ChildJobData };
};

export function createParentJobFunction(client: WorchflowClient<TriggerTestEvents>) {
  return createFunction<TriggerTestEvents, 'parent-job'>(
    { id: 'parent-job' },
    async ({ event, step }) => {
      const processed = await step.run('Process parent data', async () => {
        return { processed: event.data.message.toUpperCase() };
      });

      if (event.data.shouldTrigger) {
        const childId = await step.run('Trigger child job', async () => {
          const executionId = await client.send({
            name: 'child-job',
            data: {
              parentId: 'parent-execution',
              data: processed.processed,
            },
          });
          return executionId;
        });

        return { 
          ...processed, 
          childTriggered: true, 
          childExecutionId: childId 
        };
      }

      return { ...processed, childTriggered: false };
    }
  );
}

export const childJobFunction = createFunction<TriggerTestEvents, 'child-job'>(
  { id: 'child-job' },
  async ({ event, step }) => {
    const result = await step.run('Process child data', async () => {
      return {
        parentId: event.data.parentId,
        childData: `Child processed: ${event.data.data}`,
      };
    });

    return result;
  }
);

export function createChainStep1Function(client: WorchflowClient<TriggerTestEvents>) {
  return createFunction<TriggerTestEvents, 'chain-step-1'>(
    { id: 'chain-step-1' },
    async ({ event, step }) => {
      const result = await step.run('Chain step 1 processing', async () => {
        return { step: 1, value: `${event.data.value}-STEP1` };
      });

      const nextId = await step.run('Trigger chain step 2', async () => {
        return await client.send({
          name: 'chain-step-2',
          data: {
            step: 2,
            value: result.value,
          },
        });
      });

      return { ...result, nextExecutionId: nextId };
    }
  );
}

export function createChainStep2Function(client: WorchflowClient<TriggerTestEvents>) {
  return createFunction<TriggerTestEvents, 'chain-step-2'>(
    { id: 'chain-step-2' },
    async ({ event, step }) => {
      const result = await step.run('Chain step 2 processing', async () => {
        return { step: 2, value: `${event.data.value}-STEP2` };
      });

      const nextId = await step.run('Trigger chain step 3', async () => {
        return await client.send({
          name: 'chain-step-3',
          data: {
            step: 3,
            value: result.value,
          },
        });
      });

      return { ...result, nextExecutionId: nextId };
    }
  );
}

export const chainStep3Function = createFunction<TriggerTestEvents, 'chain-step-3'>(
  { id: 'chain-step-3' },
  async ({ event, step }) => {
    const result = await step.run('Chain step 3 processing', async () => {
      return { step: 3, value: `${event.data.value}-STEP3`, final: true };
    });

    return result;
  }
);

export function createParallelTriggerFunction(client: WorchflowClient<TriggerTestEvents>) {
  return createFunction<TriggerTestEvents, 'parallel-trigger'>(
    { id: 'parallel-trigger' },
    async ({ event, step }) => {
      const prepared = await step.run('Prepare parallel triggers', async () => {
        return { count: event.data.count, timestamp: Date.now() };
      });

      const childIds = await step.run('Trigger parallel children', async () => {
        const promises: Promise<string>[] = [];
        
        for (let i = 0; i < event.data.count; i++) {
          const childName = i === 0 ? 'parallel-child-a' : i === 1 ? 'parallel-child-b' : 'parallel-child-c';
          promises.push(
            client.send({
              name: childName as 'parallel-child-a' | 'parallel-child-b' | 'parallel-child-c',
              data: {
                parentId: 'parallel-parent',
                data: `Child ${i + 1} data`,
              },
            })
          );
        }

        return await Promise.all(promises);
      });

      return { 
        ...prepared, 
        childrenTriggered: event.data.count,
        childExecutionIds: childIds 
      };
    }
  );
}

export const parallelChildAFunction = createFunction<TriggerTestEvents, 'parallel-child-a'>(
  { id: 'parallel-child-a' },
  async ({ event, step }) => {
    return await step.run('Process parallel child A', async () => {
      return { child: 'A', parentId: event.data.parentId, result: event.data.data };
    });
  }
);

export const parallelChildBFunction = createFunction<TriggerTestEvents, 'parallel-child-b'>(
  { id: 'parallel-child-b' },
  async ({ event, step }) => {
    return await step.run('Process parallel child B', async () => {
      return { child: 'B', parentId: event.data.parentId, result: event.data.data };
    });
  }
);

export const parallelChildCFunction = createFunction<TriggerTestEvents, 'parallel-child-c'>(
  { id: 'parallel-child-c' },
  async ({ event, step }) => {
    return await step.run('Process parallel child C', async () => {
      return { child: 'C', parentId: event.data.parentId, result: event.data.data };
    });
  }
);

export function createConditionalParentFunction(client: WorchflowClient<TriggerTestEvents>) {
  return createFunction<TriggerTestEvents, 'conditional-parent'>(
    { id: 'conditional-parent' },
    async ({ event, step }) => {
      const checkResult = await step.run('Check threshold', async () => {
        const shouldTrigger = event.data.threshold > 50;
        return { threshold: event.data.threshold, shouldTrigger };
      });

      if (checkResult.shouldTrigger) {
        const childId = await step.run('Trigger conditional child', async () => {
          return await client.send({
            name: 'conditional-child',
            data: {
              parentId: 'conditional-parent',
              data: `Threshold ${event.data.threshold} exceeded`,
            },
          });
        });

        return { ...checkResult, childExecutionId: childId };
      }

      return { ...checkResult, message: 'Threshold not met, no child triggered' };
    }
  );
}

export const conditionalChildFunction = createFunction<TriggerTestEvents, 'conditional-child'>(
  { id: 'conditional-child' },
  async ({ event, step }) => {
    return await step.run('Process conditional child', async () => {
      return { 
        parentId: event.data.parentId, 
        message: `Conditional child executed: ${event.data.data}` 
      };
    });
  }
);
