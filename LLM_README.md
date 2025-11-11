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

### Type System & Data Structures

**Fully typed with strict TypeScript** - all `any` types eliminated, proper generics throughout.

#### Execution Types
- `ExecutionStatus`: `'queued' | 'completed' | 'failed' | 'retrying'` - union type for status
- `ExecutionData`: Redis hash format (all fields optional strings) - used when reading from Redis
- `ExecutionRecord`: MongoDB/TypeScript format (typed fields) - used for app logic and MongoDB
- `StepRecord`: Step document structure with `executionId`, `stepId`, `name`, `status: 'completed'`, `result`, `timestamp`

#### Generic Type Naming Convention
- `TStepResult` - step execution return values (generic)
- `TData` - event data payloads
- `TReturn` - workflow function return types
- `TEventName` - event name strings
- `TEvents` - event schema shapes

#### Key Differences
- `ExecutionData` (Redis): strings (e.g., `attemptCount: '2'`, `createdAt: '1234567890'`)
- `ExecutionRecord` (App/Mongo): typed (e.g., `attemptCount: 2`, `createdAt: 1234567890`)
- Conversion handled automatically by helper functions

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
- **DRY Principle**: All Redis/MongoDB operations abstracted into typed helper functions

### Helper Functions (Exported Utilities)

**Philosophy**: Never access Redis/MongoDB directly - always use helpers for type-safe, DRY code.

#### Redis Helpers (`utils/redis.ts`)
**Execution Operations:**
- `getExecutionKey(queuePrefix, executionId)` → string key
- `saveExecutionToRedis(redis, queuePrefix, execution: ExecutionRecord)` → converts types to strings, saves to hash
- `getExecutionFromRedis(redis, queuePrefix, executionId)` → ExecutionData (string fields)
- `updateExecutionInRedis(redis, queuePrefix, executionId, updates)` → partial updates with auto-conversion

**Step Operations:**
- `getStepsKey(queuePrefix, executionId)` → string key
- `saveStepToRedis<TStepResult>(redis, queuePrefix, executionId, stepId, result)` → wraps result with `{ cached: true, value }` and saves
- `getStepFromRedis<TStepResult>(redis, queuePrefix, executionId, stepId)` → returns unwrapped value or `undefined` for cache miss

**Key Features:**
- Automatic number → string conversion for Redis
- Automatic JSON serialization for complex objects
- Step caching uses wrapper protocol to handle `undefined`/`null` correctly
- Type-safe with generics
- Consistent key generation

#### MongoDB Helpers (`utils/mongo.ts`)
**Execution Operations:**
- `saveExecutionToMongo(db, execution: ExecutionRecord)` → typed insert
- `updateExecutionInMongo(db, executionId, updates, unsetFields?)` → typed updates with `UpdateFilter<ExecutionRecord>`
- `getExecutionFromMongo(db, executionId)` → ExecutionRecord | null
- `getExecutionsByStatus(db, status: ExecutionStatus, limit)` → ExecutionRecord[]
- `getExecutionsByEventName(db, eventName, limit)` → ExecutionRecord[]

**Step Operations:**
- `saveStepToMongo(db, step: StepRecord)` → typed insert
- `getStepsForExecution(db, executionId)` → StepRecord[]

**Key Features:**
- All collections use `collection<Type>()` for type safety
- Proper `UpdateFilter<T>` for update operations
- No `any` types - fully typed MongoDB operations
- Query helpers for common patterns

#### Index Management (`utils/indexes.ts`)
- `ensureIndexes(db, logging)` → creates all required indexes automatically
- Uses typed `Collection`, `IndexSpecification`, `CreateIndexesOptions`
- Handles conflicts gracefully (idempotent)

### Redis Keys
- `{prefix}:queue` → List of executionIds
- `{prefix}:execution:{id}` → Hash with execution metadata (strings)
- `{prefix}:steps:{id}` → Hash with stepId → JSON stringified result

### MongoDB Collections
- `executions`: { id, eventName, eventData, status, result, error, createdAt, updatedAt, attemptCount }
- `steps`: { executionId, stepId, name, status, result, timestamp }

### Internal Implementation Patterns

#### Client (`WorchflowClient.ts`)
- `send()`: Uses `saveExecutionToRedis()` + `saveExecutionToMongo()` in parallel
- `retry()`: Uses `updateExecutionInRedis()` + `updateExecutionInMongo()` with unset fields

#### Worker (`Worcher.ts`)
- Loads execution: `getExecutionFromRedis()` → validates required fields → parses JSON
- On success: `updateExecutionInRedis()` + `updateExecutionInMongo()` with result
- On failure: Re-loads with `getExecutionFromRedis()`, then updates with retry/failed status
- Uses dedicated Redis connection per execution (prevents BLPOP blocking)

#### Step (`Step.ts`)
- `run<TStepResult>()`: Generic method preserving type through execution
- Cache check: in-memory Map → `getStepFromRedis<TStepResult>()` → execute function
- Save: `saveStepToRedis<TStepResult>()` + `saveStepToMongo()` in parallel
- In-memory cache typed as `Map<string, unknown>` (not `any`)

#### Type Flow Example
```typescript
// Client sends
const execution: ExecutionRecord = { status: 'queued', attemptCount: 0, ... }
saveExecutionToRedis(redis, prefix, execution) // converts to { status: 'queued', attemptCount: '0', ... }

// Worker loads
const data: ExecutionData = await getExecutionFromRedis(redis, prefix, id) // { attemptCount: '0', ... }
const attemptCount: number = parseInt(data.attemptCount || '0', 10) // convert back

// Worker updates
await updateExecutionInRedis(redis, prefix, id, { 
  status: 'completed', 
  attemptCount: 1, 
  updatedAt: Date.now() 
}) // auto-converts numbers to strings
```

### Events
- `execution:start` → { executionId, eventName, attemptCount }
- `execution:complete` → { executionId, result } - fires AFTER Redis/MongoDB updates complete
- `execution:failed` → { executionId, error, attemptCount, willRetry }
- `execution:updated` → { executionId, status, result?, error?, attemptCount? } - fires AFTER every DB update (success, failure, or retry)

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

## Code Organization & Best Practices

### Directory Structure
```
src/
├── client/           # WorchflowClient (send events)
├── worker/           # Worcher (process queue)
├── execution/        # Step implementation
├── core/             # WorkchflowFunction class
├── types/
│   ├── config.ts     # Config interfaces
│   ├── data.ts       # ExecutionData, ExecutionRecord, StepRecord, ExecutionStatus
│   ├── function.ts   # FunctionContext, StepContext, handlers
│   └── index.ts      # Export aggregation
└── utils/
    ├── redis.ts      # Redis helpers (typed, DRY)
    ├── mongo.ts      # MongoDB helpers (typed, DRY)
    ├── indexes.ts    # Index creation
    └── hash.ts       # MD5 hashing for step IDs
```

### Typing Best Practices
1. **Never use `any`** - use `unknown` for truly dynamic types
2. **Generic naming**: `TStepResult`, `TData`, `TReturn`, `TEventName` (descriptive, not just `T`)
3. **Collection typing**: Always `db.collection<Type>('name')` for MongoDB
4. **Redis conversions**: Use helpers - they handle string ↔ number conversions
5. **Type inference**: Let TypeScript infer types when obvious - only add explicit types when inference fails or for function parameters/returns
6. **Union types**: Use for constrained values (e.g., `ExecutionStatus`)

### Maintenance Guidelines
- **Adding new execution fields**: Update both `ExecutionData` (strings) and `ExecutionRecord` (typed)
- **Adding Redis operations**: Extend helpers in `utils/redis.ts`, don't inline
- **Adding MongoDB queries**: Add to `utils/mongo.ts` with proper collection typing
- **Type exports**: Update `src/types/index.ts` and `src/index.ts` for public API
- **Testing**: Use `execution:updated` event for synchronization in tests

### Critical Implementation Details

#### Step Caching Protocol (Redis)
**Problem**: `JSON.stringify(undefined)` returns `undefined` (not a string), causing Redis to store it incorrectly. On retrieval, `JSON.parse("")` throws "Unexpected end of JSON input".

**Solution**: Wrapper protocol for cached values:
```typescript
// Save: Wrap with flag
{ cached: true, value: result }  // Handles undefined/null correctly

// Retrieve: Check for flag
if (wrapped.cached === true) return wrapped.value;
return undefined;  // Cache miss
```

**Key Points**:
- `undefined` from cache retrieval = cache miss (no entry)
- `null` or `undefined` as cached value = legitimate cached result
- Prevents JSON parse errors and duplicate MongoDB inserts on retry
- Step functions without return statements are now properly cached

#### Worker Connection Management
**Problem**: Workers were disconnecting their Redis connections before active executions finished using them, causing operations to hang and tests to timeout.

**Solution**: Track active execution promises per worker and wait for completion before disconnecting:
```typescript
const activePromises: Set<Promise<void>> = new Set();
// ... track promises ...
if (activePromises.size > 0) {
  await Promise.all(Array.from(activePromises));
}
workerRedis.disconnect();
```

**Why This Matters**:
- Each worker gets a dedicated Redis connection (`workerRedis`) for queue polling
- Each execution gets another dedicated connection (`stepRedis`) for step operations
- Must wait for ALL executions to finish before disconnecting queue connection
- Prevents race conditions where connections close mid-execution

#### Attempt Count Tracking
**Issue**: `attemptCount` was only updated on failure, not on success. If an execution succeeded on retry, the count didn't reflect actual attempts.

**Solution**: Always update `attemptCount` when marking execution as completed:
```typescript
updateExecutionInRedis(redis, prefix, id, {
  status: 'completed',
  result,
  attemptCount,  // ← Include current attempt count
  updatedAt: now,
});
```

**Result**: Dashboard now correctly shows attempt count for successful retries (e.g., "succeeded on attempt 2" instead of showing attempt 1).

#### Redis Connection Consistency
**Pattern**: Always use `this.config.redis` (shared connection) for execution metadata operations, not `workerRedis` (worker-specific connection).

**Why**: Prevents race conditions where different connections have inconsistent views of execution state during updates.

## Dev Notes
- Separate Redis clients for Client/Worker to avoid BLPOP blocking
- Worker creates dedicated Redis connection per execution for steps
- Steps cached by MD5 hash of title (stepId = hash(title))
- Multi-worker safe via atomic BLPOP
- Dashboard stops polling completed/failed executions
- All database operations go through typed helper functions
- Type conversion (strings ↔ numbers) handled automatically by helpers

## Testing & Architecture Insights

### Test Infrastructure
Located in `packages/worchflow/tests/`. Uses Vitest with:
- Isolated test contexts (unique Redis prefixes per test)
- Helper functions (all in `tests/helpers/test-setup.ts`): `createTestContext()`, `waitForExecution()`, `waitForExecutionEvent()`, `startWorcher()`, `getSteps()`
- Test functions (in `tests/helpers/test-functions.ts`): Sample workflow functions for testing
- Comprehensive console logging throughout tests (prefixed with `[TEST]`, `[EVENT]`, `[FUNCTION]`)
- Optional worker logging via `logging: true` in worker config

### Test Helper Functions (tests/helpers/test-setup.ts)

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
- Redis and MongoDB updates complete in parallel (Promise.all)
- `execution:complete` and `execution:updated` events fire AFTER both updates finish
- MongoDB is source of truth; Redis is cache
- Tests should use `execution:updated` event for synchronization (works for all statuses)

**Lifecycle Events:**
- `execution:start` fires immediately when execution begins
- `execution:complete` fires AFTER Redis/MongoDB updates finish for successful executions
- `execution:failed` fires immediately on error (before retry logic)
- `execution:updated` fires AFTER DB updates complete for ANY status (completed/failed/retrying)
- Use `execution:updated` for reliable test synchronization - it always fires after persistence
- Events are reliable for real-time monitoring and testing
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
1. Use `execution:updated` event for test synchronization (or fallback to `waitForExecution()`)
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

---

## Quick Reference Card

### Type Cheat Sheet
```typescript
// Status union type
ExecutionStatus = 'queued' | 'completed' | 'failed' | 'retrying'

// Redis format (strings)
ExecutionData: { eventName?: string, attemptCount?: string, ... }

// App/MongoDB format (typed)
ExecutionRecord: { eventName: string, attemptCount: number, status: ExecutionStatus, ... }
StepRecord: { executionId: string, stepId: string, result: any, ... }
```

### Helper Function Quick Lookup

**Redis (strings, auto-conversion):**
```typescript
// Executions
saveExecutionToRedis(redis, prefix, record: ExecutionRecord)
getExecutionFromRedis(redis, prefix, id) → ExecutionData
updateExecutionInRedis(redis, prefix, id, { status, result, ... })

// Steps (generic, uses wrapper protocol)
saveStepToRedis<T>(redis, prefix, execId, stepId, result: T)
getStepFromRedis<T>(redis, prefix, execId, stepId) → T | undefined
```

**MongoDB (typed, no conversion):**
```typescript
// Executions
saveExecutionToMongo(db, record: ExecutionRecord)
updateExecutionInMongo(db, id, updates, unsetFields?)
getExecutionFromMongo(db, id) → ExecutionRecord | null
getExecutionsByStatus(db, status, limit) → ExecutionRecord[]

// Steps
saveStepToMongo(db, step: StepRecord)
getStepsForExecution(db, execId) → StepRecord[]
```

### Key Architecture Decisions
1. **Dual storage**: Redis (speed) + MongoDB (persistence)
2. **Type duality**: ExecutionData (Redis strings) vs ExecutionRecord (app types)
3. **DRY helpers**: Never touch Redis/MongoDB directly
4. **Generic preservation**: `TStepResult` flows through entire step lifecycle
5. **No `any` types**: Use `unknown` for dynamic, proper types everywhere else
6. **Connection isolation**: Separate Redis per worker thread + per execution
7. **Atomic operations**: BLPOP ensures single processing per execution
