# Worchflow Dashboard

Next.js dashboard for monitoring and managing Worchflow executions.

## Environment Variables

Create `.env.local` with:

```
REDIS_HOST=localhost
REDIS_PORT=6379

MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=worchflow

QUEUE_PREFIX=worchflow
```

## Development

```bash
# From monorepo root
pnpm dev:dashboard

# Or from this directory
pnpm dev
```

Dashboard will be available at http://localhost:3000

## Features

- 📊 View all executions with real-time updates
- 🔍 Filter by status (queued, completed, failed)
- 📝 View execution details and step breakdown
- 🔄 Retry failed executions
- 📤 Send new events with custom data
- 📈 Live stats overview
