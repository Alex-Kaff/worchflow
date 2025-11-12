import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { WorchflowClient, Worcher, WorchflowScheduler } from '../src';
import { 
    helloWorld, 
    reportGeneration,
    multiStepRetry,
    ping,
    Events,
} from './functions.example';

async function main() {
    const redisClient = new Redis();
    const redisWorker = redisClient.duplicate();
    const mongoClient = new MongoClient('mongodb://localhost:27017');
    await mongoClient.connect();
    const db = mongoClient.db('worchflow');

    const client = new WorchflowClient<Events>({
        redis: redisClient,
        db,
    });

    const functions = [
        helloWorld, 
        reportGeneration,
        multiStepRetry,
        ping
    ];
    const worcher = new Worcher(
        { redis: redisWorker, db, logging: true },
        functions
    );

    const scheduler = new WorchflowScheduler({ 
        redis: redisClient, 
        db, 
        logging: true,
        leaderTTL: 120,
        leaderCheckInterval: 45000
    }, [ping]);

    console.log('📅 Starting scheduler...');
    scheduler.start().catch(console.error);

    worcher.on('ready', async () => {
        console.log('🚀 Worcher ready');
        await worcher.start();
    });

    worcher.on('execution:start', ({ executionId, eventName }) => {
        console.log(`▶  [${executionId.substring(0, 8)}] ${eventName} started`);
    });

    worcher.on('execution:complete', ({ executionId, result }) => {
        console.log(`✓  [${executionId.substring(0, 8)}] Completed:`, JSON.stringify(result, null, 2));
    });

    worcher.on('execution:failed', ({ executionId, error }) => {
        console.error(`✗  [${executionId.substring(0, 8)}] Failed:`, error);
    });

    worcher.on('step:complete', ({ executionId, stepName }) => {
        console.log(`   └─ [${executionId.substring(0, 8)}] Step "${stepName}" completed`);
    });

    client.on('ready', async () => {
        console.log('📡 Client ready - sending events...\n');

        await client.send({
            name: 'hello-world',
            data: { email: 'user@example.com' },
        });

        for (let i = 0; i < 2; i++) {
            await client.send({
                name: 'report-generation',
                data: { 
                    reportType: ['sales', 'analytics'][i],
                    dateRange: { start: '2025-01-01', end: '2025-01-31' }
                },
            });
        }

        await client.send({
            name: 'multi-step-retry',
            data: { 
                taskName: 'Demo Task with Retries'
            },
        });

        console.log('\n✨ All events sent! Watching executions...\n');
    });
}

main().catch(console.error);
