import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { ExecutionsResponse, Execution, ExecutionStatus } from '@/lib/types';
import type { ExecutionRecord } from 'worchflow';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as ExecutionStatus | null;
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = parseInt(searchParams.get('skip') || '0');

    const db = await getDb();
    
    const query = status ? { status } : {};
    
    const [executions, total] = await Promise.all([
      db.collection<ExecutionRecord>('executions')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray(),
      db.collection<ExecutionRecord>('executions').countDocuments(query),
    ]);

    const response: ExecutionsResponse = {
      executions: executions.map(e => ({
        ...e,
        result: (e as any).result,
        error: (e as any).error,
        errorStack: (e as any).errorStack,
      } as Execution)),
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

