import { NextResponse } from 'next/server';
import { getDb, getRedis, queuePrefix } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();
    const redis = await getRedis();

    const [execution, steps, redisExecution] = await Promise.all([
      db.collection('executions').findOne({ id }),
      db.collection('steps').find({ executionId: id }).sort({ timestamp: 1 }).toArray(),
      redis.hgetall(`${queuePrefix}:execution:${id}`),
    ]);

    if (!execution) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      execution,
      steps,
      redisExecution,
    });
  } catch (err) {
    console.error('Failed to fetch execution details:', err);
    return NextResponse.json(
      { error: 'Failed to fetch execution details' },
      { status: 500 }
    );
  }
}

