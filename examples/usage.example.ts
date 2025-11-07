import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { WorchflowClient, Worcher } from '../src';
import { helloWorld, processPayment, Events } from './functions.example';

async function main() {
    const redisClient = new Redis();
    const redisWorker = new Redis();
    const mongoClient = new MongoClient('mongodb://localhost:27017');
    await mongoClient.connect();
    const db = mongoClient.db('worchflow');

    const client = new WorchflowClient<Events>({
        redis: redisClient,
        db,
    });

    const worcher = new Worcher(
        { redis: redisWorker, db, logging: true },
        [helloWorld, processPayment]
    );

    worcher.on('ready', async () => {
        console.log('Worcher ready');
        await worcher.start();
    });

    worcher.on('execution:start', ({ executionId, eventName }) => {
        console.log(`▶ ${eventName}`);
    });

    worcher.on('execution:complete', ({ executionId, result }) => {
        console.log(`✓ Completed:`, result);
    });

    worcher.on('execution:failed', ({ executionId, error }) => {
        console.error(`✗ Failed:`, error);
    });

    client.on('ready', async () => {
        console.log('Client ready');

        await client.send({
            name: 'hello-world',
            data: { email: 'user@example.com' },
        });

        await client.send({
            name: 'process-payment',
            data: { amount: 100, customerId: 'cust_123' },
        });
    });
}

main().catch(console.error);
