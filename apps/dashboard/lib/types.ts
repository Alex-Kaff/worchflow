export type ExecutionStatus = 'queued' | 'completed' | 'failed';

export interface Execution {
  id: string;
  eventName: string;
  eventData: string;
  status: ExecutionStatus;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
  errorStack?: string;
}

export interface Step {
  executionId: string;
  stepId: string;
  result: unknown;
  timestamp: number;
}

export interface ExecutionDetails {
  execution: Execution;
  steps: Step[];
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
  completed: number;
  failed: number;
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

