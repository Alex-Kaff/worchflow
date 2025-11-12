# Worchflow


**Durable workflow orchestration for TypeScript with Redis and MongoDB**

Worchflow is a TypeScript library for building reliable, step-based workflows with automatic checkpointing, retries, and persistence. Perfect for processing payments, video encoding, data migrations, or any multi-step async task.

## Features

- **Step-based execution** with automatic checkpointing
- **Durable & resumable** - steps never re-execute on retry
- **Type-safe** with full TypeScript support
- **Redis queue** for fast job distribution
- **MongoDB persistence** for execution history
- **Built-in retries** with configurable backoff
- **Cron scheduling** with leader election and missed execution detection
- **Event-driven** with real-time execution updates
- **Multi-worker support** with configurable concurrency
- **Web dashboard** for monitoring executions

![firefox_KThRGHru0v](https://github.com/user-attachments/assets/28ffdd94-fb43-44ca-801c-2a0c7594da74)

## Quick Example

```typescript
import { createFunction, WorchflowClient, Worcher } from 'worchflow';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';

// Define your events
type Events = {
  'process-payment': {
    data: { amount: number; customerId: string };
  };
};

// Create a workflow function
const processPayment = createFunction<Events, 'process-payment'>(
  { id: 'process-payment' },
  async ({ event, step }) => {
    // Each step is checkpointed - if the workflow fails and retries,
    // completed steps won't re-execute
    const payment = await step.run('Validate payment', async () => {
      return { amount: event.data.amount, currency: 'USD' };
    });

    const result = await step.run('Charge payment provider', async () => {
      return { success: true, transactionId: 'txn_' + Date.now() };
    });

    await step.run('Send receipt', async () => {
      console.log('Receipt sent');
    });

    return result;
  }
);

// Setup
const redis = new Redis();
const db = (await new MongoClient('mongodb://localhost:27017').connect()).db('worchflow');

// Send events
const client = new WorchflowClient<Events>({ redis, db });
await client.send({ 
  name: 'process-payment', 
  data: { amount: 100, customerId: 'cust_123' } 
});

// Process workflows
const worcher = new Worcher({ redis, db, concurrency: 5 }, [processPayment]);
await worcher.start();

// Optional: Schedule workflows with cron
import { WorchflowScheduler } from 'worchflow';

const dailyCleanup = createFunction<Events, 'daily-cleanup'>(
  { id: 'daily-cleanup', cron: '0 0 * * *' }, // Run daily at midnight
  async ({ step }) => {
    await step.run('Clean up old data', async () => {
      // cleanup logic
    });
  }
);

const scheduler = new WorchflowScheduler({ redis, db }, [dailyCleanup]);
await scheduler.start(); // Automatically detects and runs missed executions
```

## Installation

```bash
npm install worchflow ioredis mongodb
# or
pnpm add worchflow ioredis mongodb
```

**Requirements:**
- Node.js >= 16
- Redis server
- MongoDB server

## Dashboard
Run the dashboard locally using ``pnpm dev:dashboard`` and then navigating to http://localhost:3000

## Project Structure

```
worchflow/
├── packages/worchflow/     # Core library (published to npm)
├── apps/dashboard/         # Next.js monitoring dashboard
└── docker-compose.yml      # Local Redis + MongoDB setup
```

## Development

```bash
# Install dependencies
pnpm install

# Start Redis + MongoDB
pnpm docker:up

# Run example workflows
pnpm example

# Start dashboard (localhost:3000)
pnpm dev:dashboard

# Build all packages
pnpm build
```

## How It Works

1. **Define workflows** as typed functions with step-based execution
2. **Send events** via the client - stored in Redis queue + MongoDB
3. **Workers process** events - executing functions with automatic checkpointing
4. **Steps are cached** - completed steps never re-run on retry/resume
5. **Monitor** via events or the web dashboard

## Configuration

```typescript
// Client & Worker Config
{
  redis: Redis,          // ioredis instance
  db: Db,                // MongoDB database
  queuePrefix?: string,  // default: 'worchflow'
  logging?: boolean,     // default: false
  concurrency?: number   // worker only, default: 1
}

// Scheduler Config
{
  redis: Redis,
  db: Db,
  queuePrefix?: string,
  logging?: boolean,
  leaderElection?: boolean,      // default: true
  leaderTTL?: number,            // default: 60
  leaderCheckInterval?: number   // default: 30000
}

// Function Config
{
  id: string,            // unique function identifier
  retries?: number,      // default: 0
  retryDelay?: number,   // delay in ms, default: 1000
  cron?: string          // cron expression (e.g., '0 * * * *' for hourly)
}
```

## Events

Listen to workflow lifecycle events:

```typescript
// Worker events
worcher.on('execution:start', ({ executionId, eventName }) => {});
worcher.on('execution:complete', ({ executionId, result }) => {});
worcher.on('execution:failed', ({ executionId, error, willRetry }) => {});
worcher.on('step:complete', ({ executionId, stepName }) => {});

// Scheduler events
scheduler.on('ready', () => {});
scheduler.on('leader:acquired', () => {});
scheduler.on('leader:lost', () => {});
scheduler.on('schedule:triggered', ({ functionId, executionId, isMissed }) => {});
scheduler.on('schedule:missed', ({ functionId, lastExecutionTime, triggeredAt }) => {});
```

## Documentation

For detailed documentation, architecture, and testing guides (written by AI for AI), see [LLM_README.md](./LLM_README.md).

## License

ISC

