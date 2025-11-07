import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = await getDb();

    const stats = await db.collection('executions').aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]).toArray();

    const statusCounts = stats.reduce((acc, { _id, count }) => {
      acc[_id || 'unknown'] = count;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      queued: statusCounts.queued || 0,
      completed: statusCounts.completed || 0,
      failed: statusCounts.failed || 0,
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    console.error('Failed to fetch stats:', err);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}

