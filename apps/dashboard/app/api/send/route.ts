import { NextResponse } from 'next/server';
import { getRedis, getDb, queuePrefix } from '@/lib/db';
import { saveExecutionToRedis, saveExecutionToMongo } from 'worchflow';
import type { ExecutionRecord, ExecutionStatus } from 'worchflow';
import type { SendEventResponse } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, data } = body;

    if (!name || !data) {
      return NextResponse.json(
        { error: 'Missing name or data' },
        { status: 400 }
      );
    }

    const redis = await getRedis();
    const db = await getDb();

    const executionId = crypto.randomUUID();
    const now = Date.now();

    const execution: ExecutionRecord = {
      id: executionId,
      eventName: name,
      eventData: JSON.stringify(data),
      status: 'queued' as ExecutionStatus,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      saveExecutionToRedis(redis, queuePrefix, execution),
      saveExecutionToMongo(db, execution),
    ]);

    await redis.rpush(`${queuePrefix}:queue`, executionId);

    const response: SendEventResponse = {
      success: true,
      executionId,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('Failed to send event:', err);
    return NextResponse.json(
      { error: 'Failed to send event' },
      { status: 500 }
    );
  }
}

