import type { Redis } from 'ioredis';
import type { Db } from 'mongodb';
import type { EventSchemaShape } from './function';

export interface BaseWorchflowConfig {
  redis: Redis;
  db: Db;
  queuePrefix?: string;
  logging?: boolean;
}

export interface WorchflowClientConfig<TEvents extends EventSchemaShape = EventSchemaShape> 
  extends BaseWorchflowConfig {
  events?: TEvents;
}

export interface WorcherConfig extends BaseWorchflowConfig {
  concurrency?: number;
}
