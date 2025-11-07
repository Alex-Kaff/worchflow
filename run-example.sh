#!/bin/bash

# Kill any stale tsx processes (excluding the current one)
pids=$(pgrep -f "tsx examples/usage.example" | grep -v $$)
if [ ! -z "$pids" ]; then
  echo "Killing stale processes: $pids"
  kill $pids 2>/dev/null || true
  sleep 0.5
fi

# Flush Redis
echo "Flushing Redis..."
docker exec worchflow-redis-1 redis-cli FLUSHALL

# Run the example
echo "Running example..."
npx tsx examples/usage.example.ts

