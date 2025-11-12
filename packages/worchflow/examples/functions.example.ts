import { createFunction } from '../src';

export type HelloWorldData = {
  email: string;
};

export type ReportGenerationData = {
  reportType: string;
  dateRange: { start: string; end: string };
};

export type MultiStepRetryData = {
  taskName: string;
};

export type PingData = {
  message: string;
};

export type Events = {
  'hello-world': {
    data: HelloWorldData;
  };
  'report-generation': {
    data: ReportGenerationData;
  };
  'multi-step-retry': {
    data: MultiStepRetryData;
  };
  'ping': {
    data: PingData;
  };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const helloWorld = createFunction<Events, 'hello-world'>(
  { id: 'hello-world' },
  async ({ event, step }) => {
    const user = await step.run('Fetch user from database', async () => {
      await sleep(500);
      return { id: 1, email: event.data.email, name: 'John Doe' };
    });

    await step.run('Send confirmation email', async () => {
      await sleep(300);
      console.log(`Sending email to ${user.email}`);
    });

    return { message: `Hello ${user.name}!` };
  }
);

export const reportGeneration = createFunction<Events, 'report-generation'>(
  { id: 'report-generation' },
  async ({ event, step }) => {
    const data = await step.run('Fetch data', async () => {
      console.log(`Fetching data for ${event.data.reportType} report...`);
      await sleep(2000);
      
      if (Math.random() < 0.2) {
        throw new Error('Database timeout - data fetch failed');
      }
      
      return { rows: 1000, columns: 25 };
    });

    const processed = await step.run('Process data', async () => {
      console.log('Processing and aggregating data...');
      await sleep(3000);
      
      if (Math.random() < 0.15) {
        throw new Error('Processing failed - out of memory');
      }
      
      return { aggregates: 50, calculations: 100 };
    });

    await step.run('Generate charts', async () => {
      console.log('Generating charts and visualizations...');
      await sleep(2500);
    });

    const report = await step.run('Create PDF', async () => {
      console.log('Creating PDF report...');
      await sleep(2000);
      return `report_${event.data.reportType}_${Date.now()}.pdf`;
    });

    await step.run('Send notification', async () => {
      await sleep(500);
      console.log('Report generation notification sent');
    });

    return {
      reportType: event.data.reportType,
      filename: report,
      dataPoints: data.rows,
      aggregates: processed.aggregates
    };
  }
);

export const multiStepRetry = createFunction<Events, 'multi-step-retry'>(
  { id: 'multi-step-retry', retries: 3 },
  async ({ event, step }) => {
    await step.run('Initial step', async () => {
      console.log(`Starting task: ${event.data.taskName}`);
      await sleep(2000);
      console.log('Initial step completed successfully');
    });

    const result = await step.run('Flaky step with retries', async (retryCount?: number) => {
      console.log(`Attempt for flaky step...`);
      await sleep(1000);
      if (Math.random() < 0.2) {
        console.log('Flaky step succeeded');
        return { attempts: retryCount, status: 'success' };
      } else {
        throw new Error(`Failed on attempt ${retryCount ?? 0}`);
      }
    });

    await step.run('Final step', async () => {
      console.log('Executing final step...');
      await sleep(500);
      console.log('Workflow completed successfully');
    });

    return {
      taskName: event.data.taskName,
      totalAttempts: result.attempts,
      status: 'completed'
    };
  }
);


export const ping = createFunction<Events, 'ping'>(
  { id: 'ping', cron: '*/10 * * * * *' }, // Run every 10 seconds
  async ({ step }) => {
    await step.run('Ping', async () => {
      console.log('Ping received');
      return { message: 'Pong' };
    });
  }
);
