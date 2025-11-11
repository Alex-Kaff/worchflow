import { NextResponse } from 'next/server';
import { getRedis, queuePrefix } from '@/lib/db';
import type { RetryResponse } from '@/lib/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const redis = await getRedis();

    await redis.rpush(`${queuePrefix}:queue`, id);

    const response: RetryResponse = {
      success: true,
      executionId: id,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('Failed to retry execution:', err);
    return NextResponse.json(
      { error: 'Failed to retry execution' },
      { status: 500 }
    );
  }
}

