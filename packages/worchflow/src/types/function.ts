export interface EventPayload<TData = any> {
  name: string;
  data: TData;
  id?: string;
  timestamp?: number;
}

export interface StepContext {
  run<TStepResult>(title: string, fn: () => Promise<TStepResult>): Promise<TStepResult>;
}

export interface FunctionContext<TData = any> {
  event: EventPayload<TData>;
  step: StepContext;
}

export interface FunctionConfig<TEventName extends string = string> {
  id: TEventName;
  retries?: number; // Number of retry attempts on failure (default: 0 = no retries)
  retryDelay?: number; // Delay in ms before retry (default: 0 = immediate)
  cron?: string; // Cron expression for scheduled execution (e.g., '0 * * * *' for hourly)
}

export type FunctionHandler<TData = any, TReturn = any> = (
  context: FunctionContext<TData>
) => Promise<TReturn>;

export interface WorkchflowFunctionMetadata<TEventName extends string = string> {
  id: TEventName;
  retries?: number;
  retryDelay?: number;
  cron?: string;
}

export interface WorkchflowFunction<
  TEventName extends string = string,
  TData = any,
  TReturn = any
> {
  readonly id: TEventName;
  readonly retries: number;
  readonly retryDelay: number;
  execute(context: FunctionContext<TData>): Promise<TReturn>;
  toMetadata(): WorkchflowFunctionMetadata<TEventName>;
}

export type EventSchemaShape = Record<string, { data: any }>;

export type ExtractEventData<
  TEvents extends EventSchemaShape,
  TEventName extends keyof TEvents
> = TEvents[TEventName]['data'];

export type SendEventPayload<TEvents extends EventSchemaShape> = {
  [K in keyof TEvents]: {
    name: K;
    data: TEvents[K]['data'];
    id?: string;
    timestamp?: number;
  };
}[keyof TEvents];
