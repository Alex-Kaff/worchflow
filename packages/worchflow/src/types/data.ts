export type ExecutionStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface ExecutionData {
  eventName?: string;
  eventData?: string;
  attemptCount?: string;
  createdAt?: string;
  status?: string;
  result?: string;
  error?: string;
  updatedAt?: string;
}

export interface ExecutionRecord {
  id: string;
  eventName: string;
  eventData: string;
  status: ExecutionStatus;
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface StepRecord {
  executionId: string;
  stepId: string;
  name: string;
  status: 'completed';
  result: any;
  timestamp: number;
}

export interface QueueItem {
  queueName: string;
  executionId: string;
}

