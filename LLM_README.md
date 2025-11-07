# Worchflow Monorepo - LLM Reference

## Structure
```
worchflow/
├── packages/worchflow/     # Core library (published to npm)
├── apps/dashboard/         # Next.js dashboard
└── docker-compose.yml      # Redis + MongoDB
```

## Core Library (`packages/worchflow`)

**Workflow orchestration**: Redis queue + MongoDB persistence + step-based execution with checkpointing.

### Usage
```typescript
type Events = { 'event-name': { data: { field: type } } }

createFunction<Events, 'event-name'>(
  { id: 'event-name' },
  async ({ event, step }) => {
    const result = await step.run('Step title', async () => value);
    return finalResult;
  }
)

const client = new WorchflowClient<Events>({ redis, db });
await client.send({ name: 'event-name', data: {...} });

const worcher = new Worcher({ redis, db, concurrency: 5, logging: true }, [functions]);
await worcher.start();
```

### Config
```typescript
{
  redis: Redis,          // ioredis instance
  db: Db,                // MongoDB database
  queuePrefix?: string,  // default: 'worchflow'
  logging?: boolean,     // default: false
  concurrency?: number   // worker only, default: 1
}
```

### Architecture
- Client: sends events → Redis queue + MongoDB
- Worker: BLPOP from queue → executes functions with step checkpointing
- Step: Redis-first cache (HGET/HSET) + MongoDB persistence
- Each execution gets dedicated Redis connection (prevents BLPOP blocking)

### Redis Keys
- `{prefix}:queue` → List of executionIds
- `{prefix}:execution:{id}` → Hash with execution metadata
- `{prefix}:steps:{id}` → Hash with stepId → cached result

### MongoDB Collections
- `executions`: { id, eventName, eventData, status, result, error, createdAt, updatedAt }
- `steps`: { executionId, stepId, result, timestamp }

### Events
- `execution:start` → { executionId, eventName }
- `execution:complete` → { executionId, result }
- `execution:failed` → { executionId, error }

### Retry
Failed executions auto-retry immediately (re-queued to Redis).

## Dashboard (`apps/dashboard`)

Next.js app at `localhost:3000`:
- **List executions** - filterable by status, auto-refreshes every 2s
- **View details** - execution metadata, steps, results/errors (stops polling when complete)
- **Send events** - manual event submission with JSON editor
- **Retry failed** - re-queue failed executions
- **Stats overview** - queued/completed/failed counts

### Tech Stack
- Next.js 16 App Router
- TypeScript with strict types
- TailwindCSS 4
- Centralized API client (`lib/api.ts`)
- Shared types (`lib/types.ts`)

### API Routes
- `GET /api/executions?status=&limit=&skip=` - list executions
- `GET /api/executions/[id]` - execution details + steps
- `POST /api/executions/[id]/retry` - retry execution
- `GET /api/stats` - overview statistics
- `POST /api/send` - send new event

## Commands
```bash
pnpm install                 # Install all workspaces
pnpm docker:up               # Start Redis + MongoDB
pnpm docker:down             # Stop and remove containers
pnpm build                   # Build all packages
pnpm example                 # Run worchflow example (packages/worchflow)
pnpm dev:dashboard           # Start dashboard (localhost:3000)
```

## Dev Notes
- Separate Redis clients for Client/Worker to avoid BLPOP blocking
- Worker creates dedicated Redis connection per execution for steps
- Steps cached by MD5 hash of title
- Multi-worker safe via atomic BLPOP
- Dashboard stops polling completed/failed executions

