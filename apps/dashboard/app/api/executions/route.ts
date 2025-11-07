import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { ExecutionsResponse } from '@/lib/types';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = parseInt(searchParams.get('skip') || '0');

    const db = await getDb();
    
    const query = status ? { status } : {};
    
    const [executions, total] = await Promise.all([
      db.collection('executions')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray(),
      db.collection('executions').countDocuments(query),
    ]);

    const response: ExecutionsResponse = {
      executions: executions.map(e => ({
        id: e.id,
        eventName: e.eventName,
        eventData: e.eventData,
        status: e.status,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        result: e.result,
        error: e.error,
        errorStack: e.errorStack,
      })),
      total,
      limit,
      skip,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to fetch executions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch executions' },
      { status: 500 }
    );
  }
}

