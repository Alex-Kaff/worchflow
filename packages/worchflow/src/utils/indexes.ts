import type { Collection, Db, IndexSpecification, CreateIndexesOptions } from 'mongodb';

export async function ensureIndexes(db: Db, logging: boolean = false): Promise<void> {
  const log = (msg: string): void => {
    if (logging) {
      console.log(`[Worchflow] ${msg}`);
    }
  };

  const createIndexSafe = async (
    collection: Collection,
    spec: IndexSpecification,
    options: CreateIndexesOptions,
    description: string
  ): Promise<void> => {
    try {
      await collection.createIndex(spec, options);
      log(`✓ Created index: ${description}`);
    } catch (error: any) {
      if (error.code === 85 || error.codeName === 'IndexOptionsConflict') {
        log(`✓ Index already exists: ${description}`);
      } else if (error.code === 86 || error.codeName === 'IndexKeySpecsConflict') {
        log(`✓ Index already exists: ${description}`);
      } else {
        throw error;
      }
    }
  };

  try {
    const executionsCollection = db.collection('executions');
    const stepsCollection = db.collection('steps');

    log('Setting up MongoDB indexes...');

    await Promise.all([
      createIndexSafe(
        executionsCollection,
        { id: 1 },
        { unique: true, name: 'idx_executions_id' },
        'executions.id (unique)'
      ),

      createIndexSafe(
        executionsCollection,
        { status: 1, createdAt: -1 },
        { name: 'idx_executions_status_createdAt' },
        'executions.status + createdAt'
      ),

      createIndexSafe(
        executionsCollection,
        { createdAt: -1 },
        { name: 'idx_executions_createdAt' },
        'executions.createdAt'
      ),

      createIndexSafe(
        executionsCollection,
        { eventName: 1, createdAt: -1 },
        { name: 'idx_executions_eventName_createdAt' },
        'executions.eventName + createdAt'
      ),

      createIndexSafe(
        stepsCollection,
        { executionId: 1, timestamp: 1 },
        { name: 'idx_steps_executionId_timestamp' },
        'steps.executionId + timestamp'
      ),

      createIndexSafe(
        stepsCollection,
        { executionId: 1, stepId: 1 },
        { unique: true, name: 'idx_steps_executionId_stepId' },
        'steps.executionId + stepId (unique)'
      ),
    ]);

    log('MongoDB indexes setup complete');
  } catch (error) {
    if (logging) {
      console.error('[Worchflow] Failed to create indexes:', error);
    }
    throw error;
  }
}

