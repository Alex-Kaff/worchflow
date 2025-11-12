import type { Db, UpdateFilter } from 'mongodb';
import type { ExecutionRecord, ExecutionStatus, StepRecord, ScheduleRecord } from '../types';

export async function saveExecutionToMongo(
  db: Db,
  execution: ExecutionRecord
): Promise<void> {
  await db.collection<ExecutionRecord>('executions').insertOne(execution);
}

export async function updateExecutionInMongo(
  db: Db,
  executionId: string,
  updates: Partial<{
    status: ExecutionStatus;
    result: any;
    error: string;
    errorStack: string;
    attemptCount: number;
    updatedAt: number;
  }>,
  unsetFields?: string[]
): Promise<void> {
  const updateDoc: UpdateFilter<ExecutionRecord> = {};

  if (Object.keys(updates).length > 0) {
    updateDoc.$set = updates;
  }

  if (unsetFields && unsetFields.length > 0) {
    updateDoc.$unset = {};
    for (const field of unsetFields) {
      updateDoc.$unset[field] = '';
    }
  }

  await db.collection<ExecutionRecord>('executions').updateOne(
    { id: executionId },
    updateDoc
  );
}

export async function saveStepToMongo(
  db: Db,
  step: StepRecord
): Promise<void> {
  await db.collection<StepRecord>('steps').insertOne(step);
}

export async function getExecutionFromMongo(
  db: Db,
  executionId: string
): Promise<ExecutionRecord | null> {
  return await db.collection<ExecutionRecord>('executions').findOne({ id: executionId });
}

export async function getExecutionsByStatus(
  db: Db,
  status: ExecutionStatus,
  limit: number = 100
): Promise<ExecutionRecord[]> {
  return await db.collection<ExecutionRecord>('executions')
    .find({ status })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getExecutionsByEventName(
  db: Db,
  eventName: string,
  limit: number = 100
): Promise<ExecutionRecord[]> {
  return await db.collection<ExecutionRecord>('executions')
    .find({ eventName })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getStepsForExecution(
  db: Db,
  executionId: string
): Promise<StepRecord[]> {
  return await db.collection<StepRecord>('steps')
    .find({ executionId })
    .sort({ timestamp: 1 })
    .toArray();
}

export async function getOrphanedExecutions(
  db: Db
): Promise<ExecutionRecord[]> {
  return await db.collection<ExecutionRecord>('executions')
    .find({ status: { $in: ['processing', 'retrying'] } })
    .sort({ createdAt: 1 })
    .toArray();
}

export async function saveScheduleToMongo(
  db: Db,
  schedule: ScheduleRecord
): Promise<void> {
  await db.collection<ScheduleRecord>('schedules').insertOne(schedule);
}

export async function updateScheduleInMongo(
  db: Db,
  functionId: string,
  updates: Partial<{
    lastTriggered: number;
    nextRun: number;
    enabled: boolean;
    updatedAt: number;
  }>
): Promise<void> {
  const updateDoc: UpdateFilter<ScheduleRecord> = { $set: updates };
  
  await db.collection<ScheduleRecord>('schedules').updateOne(
    { functionId },
    updateDoc,
    { upsert: true }
  );
}

export async function getScheduleFromMongo(
  db: Db,
  functionId: string
): Promise<ScheduleRecord | null> {
  return await db.collection<ScheduleRecord>('schedules').findOne({ functionId });
}

export async function getAllSchedules(
  db: Db
): Promise<ScheduleRecord[]> {
  return await db.collection<ScheduleRecord>('schedules')
    .find()
    .sort({ functionId: 1 })
    .toArray();
}

export async function getEnabledSchedules(
  db: Db
): Promise<ScheduleRecord[]> {
  return await db.collection<ScheduleRecord>('schedules')
    .find({ enabled: true })
    .sort({ functionId: 1 })
    .toArray();
}

