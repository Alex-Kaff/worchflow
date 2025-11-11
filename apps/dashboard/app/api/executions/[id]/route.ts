import { NextResponse } from 'next/server';
import { getDb, getRedis, queuePrefix } from '@/lib/db';
import { getExecutionFromMongo, getStepsForExecution, getExecutionKey } from 'worchflow';
import type { ExecutionDetails } from '@/lib/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const redis = await getRedis();

    const [execution, steps, redisExecution] = await Promise.all([
      getExecutionFromMongo(db, id),
      getStepsForExecution(db, id),
      redis.hgetall(getExecutionKey(queuePrefix, id)),
    ]);

    if (!execution) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    const response: ExecutionDetails = {
      execution: {
        ...execution,
        result: (execution as any).result,
        error: (execution as any).error,
        errorStack: (execution as any).errorStack,
      },
      steps,
      redisExecution,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('Failed to fetch execution details:', err);
    return NextResponse.json(
      { error: 'Failed to fetch execution details' },
      { status: 500 }
    );
  }
}

