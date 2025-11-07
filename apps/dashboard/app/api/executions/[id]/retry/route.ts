import { NextResponse } from 'next/server';
import { getRedis, queuePrefix } from '@/lib/db';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const redis = await getRedis();

    await redis.rpush(`${queuePrefix}:queue`, id);

    return NextResponse.json({ success: true, executionId: id });
  } catch (err) {
    console.error('Failed to retry execution:', err);
    return NextResponse.json(
      { error: 'Failed to retry execution' },
      { status: 500 }
    );
  }
}

