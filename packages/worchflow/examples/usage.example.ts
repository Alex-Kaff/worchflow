import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { WorchflowClient, Worcher } from '../src';
import { 
    helloWorld, 
    processPayment, 
    videoProcessing,
    dataMigration,
    emailCampaign,
    imageResize,
    webhookRetry,
    dataValidation,
    reportGeneration,
    multiStepRetry,
    Events 
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

    const worcher = new Worcher(
        { redis: redisWorker, db, logging: true },
        [
            helloWorld, 
            processPayment,
            videoProcessing,
            dataMigration,
            emailCampaign,
            imageResize,
            webhookRetry,
            dataValidation,
            reportGeneration,
            multiStepRetry
        ]
    );

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

        await client.send({
            name: 'process-payment',
            data: { amount: 100, customerId: 'cust_123' },
        });

        await client.send({
            name: 'video-processing',
            data: { 
                videoUrl: 'https://example.com/video.mp4',
                userId: 'user_456'
            },
        });

        await client.send({
            name: 'data-migration',
            data: { batchSize: 1000 },
        });

        await client.send({
            name: 'email-campaign',
            data: { 
                campaignId: 'camp_789',
                recipientCount: 350
            },
        });

        await client.send({
            name: 'image-resize',
            data: { 
                imageUrl: 'https://example.com/photo.jpg',
                sizes: [200, 400, 800, 1200]
            },
        });

        for (let i = 0; i < 3; i++) {
            await client.send({
                name: 'webhook-retry',
                data: { 
                    webhookUrl: `https://example.com/webhook-${i}`,
                    payload: { eventType: 'test', attempt: i }
                },
            });
        }

        await client.send({
            name: 'data-validation',
            data: { 
                records: [
                    { id: 1, name: 'Alice', email: 'alice@example.com' },
                    { id: 2, name: 'Bob', email: 'bob@example.com' },
                    { id: 3, name: 'Charlie', email: 'charlie@example.com' },
                    { id: 4, name: 'Diana', email: 'diana@example.com' },
                    { id: 5, name: 'Eve', email: 'eve@example.com' },
                ]
            },
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
