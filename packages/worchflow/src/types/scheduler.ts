import type { EventSchemaShape } from './function';
import type { WorchflowClientConfig } from './config';
import type { WorkchflowFunction as CoreWorkchflowFunction } from '../core/WorkchflowFunction';

export type WorkchflowFunctionWithCron<TEvents extends EventSchemaShape, TEventName extends keyof TEvents & string> = 
  CoreWorkchflowFunction<TEvents, TEventName> & { readonly cron: string };

export type AnyWorkchflowFunction<TEvents extends EventSchemaShape> = {
  [K in keyof TEvents]: WorkchflowFunctionWithCron<TEvents, K & string>;
}[keyof TEvents];

export type InputWorkchflowFunction<TEvents extends EventSchemaShape> = {
  [K in keyof TEvents]: CoreWorkchflowFunction<TEvents, K & string>;
}[keyof TEvents];

export interface CronExecutionRecord {
  functionId: string;
  lastExecutionTime: Date;
  nextScheduledTime: Date;
  cronExpression: string;
  updatedAt: Date;
}

export interface SchedulerConfig<TEvents extends EventSchemaShape = EventSchemaShape>
  extends WorchflowClientConfig<TEvents> {
  leaderElection?: boolean;
  leaderTTL?: number;
  leaderCheckInterval?: number;
}

export interface ScheduledFunctionInfo {
  id: string;
  cron: string;
  nextRun: Date;
}

export interface ScheduleTriggeredEvent {
  functionId: string;
  executionId: string;
  timestamp: number;
  isMissed: boolean;
}

export interface ScheduleRegisteredEvent {
  functionId: string;
  cron: string;
  nextRun: Date;
}

export interface ScheduleMissedEvent {
  functionId: string;
  lastExecutionTime: Date;
  triggeredAt: Date;
}

export interface CronParseResult {
  isValid: boolean;
  error?: string;
  nextRun?: Date;
}

