import { Redis } from 'ioredis';
import { MongoClient, Db } from 'mongodb';

let redis: Redis | null = null;
let db: Db | null = null;

export async function getRedis(): Promise<Redis> {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    });
  }
  return redis;
}

export async function getDb(): Promise<Db> {
  if (!db) {
    const client = new MongoClient(
      process.env.MONGODB_URI || 'mongodb://localhost:27017'
    );
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'worchflow');
  }
  return db;
}

export const queuePrefix = process.env.QUEUE_PREFIX || 'worchflow';

