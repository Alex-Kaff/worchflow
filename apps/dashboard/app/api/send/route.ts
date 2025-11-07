import { NextResponse } from 'next/server';
import { getRedis, getDb, queuePrefix } from '@/lib/db';

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

    const execution = {
      id: executionId,
      eventName: name,
      eventData: JSON.stringify(data),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      redis.hset(`${queuePrefix}:execution:${executionId}`, execution),
      db.collection('executions').insertOne(execution),
    ]);

    await redis.rpush(`${queuePrefix}:queue`, executionId);

    return NextResponse.json({ 
      success: true, 
      executionId,
    });
  } catch (err) {
    console.error('Failed to send event:', err);
    return NextResponse.json(
      { error: 'Failed to send event' },
      { status: 500 }
    );
  }
}

