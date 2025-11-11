import type { ExecutionStatus, ExecutionRecord, StepRecord } from 'worchflow';

export type { ExecutionStatus, ExecutionRecord, StepRecord };

export interface Execution extends ExecutionRecord {
  result?: unknown;
  error?: string;
  errorStack?: string;
}

export interface ExecutionDetails {
  execution: Execution;
  steps: StepRecord[];
  redisExecution?: Record<string, string>;
}

export interface ExecutionsResponse {
  executions: Execution[];
  total: number;
  limit: number;
  skip: number;
}

export interface StatsResponse {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  retrying: number;
  total: number;
}

export interface SendEventRequest {
  name: string;
  data: unknown;
}

export interface SendEventResponse {
  success: boolean;
  executionId: string;
}

export interface RetryResponse {
  success: boolean;
  executionId: string;
}

