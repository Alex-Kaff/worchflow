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
- **MongoDB Indexes**: Automatically created on initialization for optimal query performance

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
- Configurable per-function via `retries` and `retryDelay` options
- `retries: 2` means 3 total attempts (initial + 2 retries)
- Automatic retry on failure (re-queued to Redis) if within retry limit
- Manual retry via `client.retry(executionId)` resets attempt count
- Status during retries: `'retrying'` (auto) or `'failed'` (exceeded limit)

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

## Testing & Architecture Insights

### Test Infrastructure
Located in `packages/worchflow/tests/`. Uses Vitest with:
- Isolated test contexts (unique Redis prefixes per test)
- Helper functions: `createTestContext()`, `waitForExecution()`, `startWorcher()`, `getSteps()`
- Comprehensive console logging throughout tests (prefixed with `[TEST]`, `[EVENT]`, `[FUNCTION]`)
- Optional worker logging via `logging: true` in worker config

### Test Helper Functions

**`createTestContext()`**
- Creates isolated Redis + MongoDB connections per test
- Generates unique `queuePrefix` (e.g., `test:a1b2c3d4`)
- Returns `{ redis, redisWorker, db, queuePrefix, cleanup }`
- Call in `beforeEach` for test isolation

**`startWorcher(worcher)`**
- ⚠️ CRITICAL: Waits for `ready` event before starting worcher
- Pattern: `await startWorcher(worcher)` - NOT `await worcher.start()`
- Handles async startup properly (waits 200ms for stabilization)
- Common mistake: calling `worcher.on('ready', ...)` AND `startWorcher()` causes hang (ready fires only once!)

**`waitForExecution(db, executionId, status, timeout=5000)`**
- Polls MongoDB every 100ms for execution status
- Throws error if timeout exceeded
- Always use MongoDB, not Redis (source of truth)

**`getSteps(db, executionId)`**
- Fetches all steps for an execution from MongoDB
- Returns array of step documents

### Key Behavioral Patterns

**Async Update Timing:**
- MongoDB updates complete FIRST (synchronously awaited)
- Redis updates complete AFTER (async, but reliable)
- MongoDB is source of truth; Redis is cache
- Tests should wait for MongoDB status, not Redis

**Lifecycle Events:**
- `execution:start` fires immediately when execution begins
- `execution:complete` fires BEFORE Redis/MongoDB updates finish (intentional for responsiveness)
- `execution:failed` fires immediately on error
- Events are reliable for real-time monitoring
- ⚠️ `ready` event fires ONCE on worcher start - don't double-listen!

**Concurrency Behavior:**
- Worker spawns N threads (configurable via `concurrency`)
- Each thread gets its own Redis connection (prevents blocking)
- All threads poll queue via atomic BLPOP
- Executions process truly in parallel
- ⚠️ Critical: Shared Redis connection across threads causes serialization!
- Architecture: ONE Worcher with high concurrency (recommended) OR multiple Worchers for different queues/priorities

**Step Checkpointing:**
- Steps cached in-memory (Map), Redis (HSET), and MongoDB (document)
- Cache lookup order: Memory → Redis → execute
- On retry/resume, completed steps never re-execute
- Step ID = MD5 hash of step title (collisions theoretically possible but unlikely)

### Testing Tips & Common Pitfalls

**✅ Do This:**
1. Use `waitForExecution(db, id, status, timeout)` not Redis checks
2. Call `await startWorcher(worcher)` ONCE per test
3. Register event handlers BEFORE calling `startWorcher()`
4. Always call `worcher.stop()` in test cleanup (`afterEach`)
5. Use unique `queuePrefix` per test for isolation (handled by `createTestContext()`)
6. Check console logs prefixed with `[TEST]`, `[EVENT]`, `[FUNCTION]` for debugging

**❌ Don't Do This:**
1. ❌ `await worcher.on('ready', ...).then(() => startWorcher(worcher))` - causes hang!
2. ❌ `await worcher.start()` directly in tests - use helper function
3. ❌ Checking Redis for execution status - use MongoDB
4. ❌ Sharing Redis clients between tests - create fresh context
5. ❌ Assuming immediate updates - use polling helpers

**Common Issues:**
- **Test hangs**: Likely waiting for `ready` event twice (once manually, once in helper)
- **Execution not found**: Check `queuePrefix` matches between client/worker
- **Timeout errors**: Increase timeout in `waitForExecution()` for complex workflows
- **Cross-test pollution**: Ensure `afterEach` cleanup runs properly
