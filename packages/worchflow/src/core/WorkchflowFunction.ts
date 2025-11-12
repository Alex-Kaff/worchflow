import type {
  FunctionConfig,
  FunctionHandler,
  FunctionContext,
  WorkchflowFunction as IWorkchflowFunction,
  WorkchflowFunctionMetadata,
  EventSchemaShape,
  ExtractEventData,
} from '../types';

export class WorkchflowFunction<
  TEvents extends EventSchemaShape,
  TEventName extends keyof TEvents & string
> implements IWorkchflowFunction<TEventName, ExtractEventData<TEvents, TEventName>, any> {
  public readonly id: TEventName;
  public readonly retries: number;
  public readonly retryDelay: number;
  public readonly cron?: string;
  public readonly config: FunctionConfig<TEventName>;
  private handler: FunctionHandler<ExtractEventData<TEvents, TEventName>, any>;

  constructor(
    config: FunctionConfig<TEventName>,
    handler: FunctionHandler<ExtractEventData<TEvents, TEventName>, any>
  ) {
    this.id = config.id;
    this.retries = config.retries ?? 0;
    this.retryDelay = config.retryDelay ?? 0;
    this.cron = config.cron;
    this.config = config;
    this.handler = handler;
  }

  async execute(context: FunctionContext<ExtractEventData<TEvents, TEventName>>): Promise<any> {
    return await this.handler(context);
  }

  toMetadata(): WorkchflowFunctionMetadata<TEventName> {
    return {
      id: this.id,
      retries: this.retries,
      retryDelay: this.retryDelay,
      cron: this.cron,
    };
  }
}

export function createFunction<
  TEvents extends EventSchemaShape,
  TEventName extends keyof TEvents & string,
  TReturn = any
>(
  config: FunctionConfig<TEventName>,
  handler: FunctionHandler<ExtractEventData<TEvents, TEventName>, TReturn>
): WorkchflowFunction<TEvents, TEventName> {
  return new WorkchflowFunction(config, handler);
}
