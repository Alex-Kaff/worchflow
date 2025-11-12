import { CronJob } from 'cron';
import type { CronParseResult } from '../types/scheduler';

export function validateCronExpression(expression: string): boolean {
  try {
    new CronJob(expression, () => {});
    return true;
  } catch {
    return false;
  }
}

export function getNextCronRun(expression: string): Date {
  const job = new CronJob(expression, () => {});
  return job.nextDate().toJSDate();
}

export function parseCronExpression(expression: string): CronParseResult {
  try {
    const job = new CronJob(expression, () => {});
    return {
      isValid: true,
      nextRun: job.nextDate().toJSDate(),
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Invalid cron expression',
    };
  }
}

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const MIN_CRON_PARTS = 5;

export function shouldHaveRun(
  expression: string,
  lastRunTime: Date,
  currentTime: Date = new Date(),
  debug: boolean = false
): boolean {
  if (lastRunTime >= currentTime) {
    return false;
  }
  
  try {
    const minInterval = getMinimumIntervalMs(expression);
    
    if (minInterval === null) {
      return false;
    }
    
    const nextExpectedRun = new Date(lastRunTime.getTime() + minInterval);
    const result = nextExpectedRun <= currentTime;
    
    if (debug) {
      logDebugInfo(minInterval, lastRunTime, nextExpectedRun, currentTime, result);
    }
    
    return result;
  } catch {
    return false;
  }
}

function logDebugInfo(
  minInterval: number,
  lastRunTime: Date,
  nextExpectedRun: Date,
  currentTime: Date,
  result: boolean
): void {
  console.log(`[shouldHaveRun] minInterval: ${minInterval}ms (${Math.floor(minInterval / MILLISECONDS_PER_SECOND)}s)`);
  console.log(`[shouldHaveRun] lastRunTime: ${lastRunTime.toISOString()}`);
  console.log(`[shouldHaveRun] nextExpectedRun: ${nextExpectedRun.toISOString()}`);
  console.log(`[shouldHaveRun] currentTime: ${currentTime.toISOString()}`);
  console.log(`[shouldHaveRun] result: ${result}`);
}

function getMinimumIntervalMs(expression: string): number | null {
  try {
    const parts = expression.trim().split(/\s+/);
    if (parts.length < MIN_CRON_PARTS) {
      return null;
    }
    
    const secondsPart = parts[0];
    
    if (secondsPart.startsWith('*/')) {
      return parseIntervalExpression(secondsPart);
    }
    
    if (secondsPart === '*') {
      return MILLISECONDS_PER_SECOND;
    }
    
    if (/^\d+$/.test(secondsPart)) {
      return MILLISECONDS_PER_MINUTE;
    }
    
    if (secondsPart.includes(',')) {
      return parseListExpression(secondsPart);
    }
    
    return MILLISECONDS_PER_MINUTE;
  } catch {
    return MILLISECONDS_PER_MINUTE;
  }
}

function parseIntervalExpression(secondsPart: string): number | null {
  const interval = parseInt(secondsPart.substring(2), 10);
  if (!isNaN(interval) && interval > 0) {
    return interval * MILLISECONDS_PER_SECOND;
  }
  return null;
}

function parseListExpression(secondsPart: string): number {
  const values = secondsPart
    .split(',')
    .map(v => parseInt(v.trim(), 10))
    .filter(v => !isNaN(v))
    .sort((a, b) => a - b);
    
  if (values.length >= 2) {
    let minDiff = SECONDS_PER_MINUTE;
    for (let i = 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      if (diff < minDiff) {
        minDiff = diff;
      }
    }
    return minDiff * MILLISECONDS_PER_SECOND;
  }
  
  return MILLISECONDS_PER_MINUTE;
}

