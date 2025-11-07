export interface EventPayload<TData = any> {
  name: string;
  data: TData;
  id?: string;
  timestamp?: number;
}

export interface StepContext {
  run<T>(title: string, fn: () => Promise<T>): Promise<T>;
}

export interface FunctionContext<TData = any> {
  event: EventPayload<TData>;
  step: StepContext;
}

export interface FunctionConfig<TEventName extends string = string> {
  id: TEventName;
}

export type FunctionHandler<TData = any, TReturn = any> = (
  context: FunctionContext<TData>
) => Promise<TReturn>;

export interface WorkchflowFunctionMetadata<TEventName extends string = string> {
  id: TEventName;
}

export interface WorkchflowFunction<
  TEventName extends string = string,
  TData = any,
  TReturn = any
> {
  readonly id: TEventName;
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
