# Worchflow - LLM Reference

## Overview
Workflow orchestration system with step-based execution, automatic checkpointing, and type-safe event schemas. Built on Redis (queue) + MongoDB (persistence).

## Core Concepts

### Event Schema Pattern
Define all events as a TypeScript type:
```typescript
type Events = {
  'event-name': { data: { field: type } }
}
```

### Function Creation
```typescript
createFunction<Events, 'event-name'>(
  { id: 'event-name' },
  async ({ event, step }) => {
    // event.data is typed from Events['event-name']['data']
    const result = await step.run('Step title', async () => {
      // Step logic - runs once, cached on retry
      return value;
    });
    return finalResult;
  }
)
```

### Client (Event Submission)
```typescript
const client = new WorchflowClient<Events>({ redis, db });
await client.send({
  name: 'event-name',  // Validated against Events keys
  data: { ... }        // Validated against Events[name]['data']
});
```

### Worker (Event Processing)
```typescript
const worcher = new Worcher({ redis, db }, [function1, function2]);
await worcher.start(); // Polls Redis, executes functions
```

## Step Execution
- Steps identified by MD5 hash of title string
- Completed steps cached in MongoDB
- On retry: completed steps return cached value, failed/incomplete steps re-execute
- Sequential execution only (no parallel steps)

## Data Flow
1. Client.send() → generates executionId → stores in MongoDB + Redis → queues to Redis
2. Worcher polls Redis → BLPOP executionId (atomic, multi-worker safe) → loads from Redis
3. Step.run() → checks memory cache → checks Redis → executes if not cached → saves to Redis + MongoDB
4. Function completes → updates execution status in Redis + MongoDB
5. On failure → updates status → re-queues executionId to Redis for immediate retry

## Redis Data Structures
```
{queuePrefix}:queue                      → List (RPUSH to add, BLPOP to consume)
{queuePrefix}:execution:{executionId}    → Hash (execution metadata)
{queuePrefix}:steps:{executionId}        → Hash (stepId → JSON result)
```

Default `queuePrefix` is `worchflow`.

## Type System

### Key Types
- `EventSchemaShape`: `Record<string, { data: any }>`
- `SendEventPayload<Events>`: Union of all event shapes with name + data
- `ExtractEventData<Events, Name>`: Extracts `Events[Name]['data']`
- `FunctionContext<TData>`: `{ event: EventPayload<TData>, step: StepContext }`

### Generic Constraints
- `createFunction<TEvents, TEventName>` where `TEventName extends keyof TEvents`
- `WorchflowClient<TEvents>` validates send() payload against TEvents
- Function handlers receive typed `event.data` via `ExtractEventData<TEvents, TEventName>`

## Architecture

```
src/
├── client/WorchflowClient.ts   # Event submission, generic over Events type
├── worker/Worcher.ts            # Event processing, function registry
├── core/WorkchflowFunction.ts   # Function class, createFunction factory
├── execution/Step.ts            # Step execution, checkpointing logic
├── types/                       # Type definitions
└── utils/hash.ts                # MD5 hashing for step IDs
```

## Dependencies
- `ioredis`: Redis client (peer dep)
- `mongodb`: MongoDB native driver (peer dep)
- Users provide configured Redis + MongoDB instances

## Configuration
```typescript
BaseWorchflowConfig {
  redis: Redis;    // ioredis instance
  db: Db;          // MongoDB database
  queuePrefix?: string;  // Default: 'worchflow'
}

WorchflowClientConfig<TEvents> extends BaseWorchflowConfig {
  events?: TEvents;  // Optional, used for type inference only
}

WorcherConfig extends BaseWorchflowConfig {
  concurrency?: number;  // Default: 1, number of parallel executions
}
```

## Initialization Pattern
Both Client and Worcher:
- Extend EventEmitter
- Ping Redis + MongoDB on construction
- Emit 'ready' when connected
- Emit 'error' on failure

## Current Status
- ✅ Type system implemented
- ✅ Core classes scaffolded
- ✅ Client.send() - generates executionId, stores in Redis + MongoDB, queues to Redis
- ✅ Worcher.start() - polls Redis BLPOP, processes executions with configurable concurrency
- ✅ Step.run() checkpointing - Redis-first cache with MongoDB persistence
- ✅ Worker events - execution:start, execution:complete, execution:failed
- ✅ Retry on failure - failed executions automatically re-queued
- ✅ Graceful shutdown - Worcher.stop() waits for active executions

