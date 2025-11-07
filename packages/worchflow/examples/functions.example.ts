import { createFunction } from '../src';

export type HelloWorldData = {
  email: string;
};

export type ProcessPaymentData = {
  amount: number;
  customerId: string;
};

export type VideoProcessingData = {
  videoUrl: string;
  userId: string;
};

export type DataMigrationData = {
  batchSize: number;
};

export type EmailCampaignData = {
  campaignId: string;
  recipientCount: number;
};

export type ImageResizeData = {
  imageUrl: string;
  sizes: number[];
};

export type WebhookRetryData = {
  webhookUrl: string;
  payload: Record<string, any>;
};

export type DataValidationData = {
  records: Array<Record<string, any>>;
};

export type ReportGenerationData = {
  reportType: string;
  dateRange: { start: string; end: string };
};

export type Events = {
  'hello-world': {
    data: HelloWorldData;
  };
  'process-payment': {
    data: ProcessPaymentData;
  };
  'video-processing': {
    data: VideoProcessingData;
  };
  'data-migration': {
    data: DataMigrationData;
  };
  'email-campaign': {
    data: EmailCampaignData;
  };
  'image-resize': {
    data: ImageResizeData;
  };
  'webhook-retry': {
    data: WebhookRetryData;
  };
  'data-validation': {
    data: DataValidationData;
  };
  'report-generation': {
    data: ReportGenerationData;
  };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const helloWorld = createFunction<Events, 'hello-world'>(
  { id: 'hello-world' },
  async ({ event, step }) => {
    const user = await step.run('Fetch user from database', async () => {
      await sleep(500);
      return { id: 1, email: event.data.email, name: 'John Doe' };
    });

    await step.run('Send confirmation email', async () => {
      await sleep(300);
      console.log(`Sending email to ${user.email}`);
    });

    return { message: `Hello ${user.name}!` };
  }
);

export const processPayment = createFunction<Events, 'process-payment'>(
  { id: 'process-payment' },
  async ({ event, step }) => {
    const payment = await step.run('Validate payment details', async () => {
      await sleep(400);
      return { amount: event.data.amount, currency: 'USD' };
    });

    const result = await step.run('Charge payment provider', async () => {
      await sleep(800);
      return { success: true, transactionId: 'txn_' + Date.now() };
    });

    await step.run('Send receipt email', async () => {
      await sleep(300);
      console.log('Receipt sent');
    });

    return result;
  }
);

export const videoProcessing = createFunction<Events, 'video-processing'>(
  { id: 'video-processing' },
  async ({ event, step }) => {
    await step.run('Download video', async () => {
      console.log(`Downloading video from ${event.data.videoUrl}`);
      await sleep(2000);
    });

    await step.run('Extract audio', async () => {
      console.log('Extracting audio track...');
      await sleep(3000);
    });

    await step.run('Generate thumbnails', async () => {
      console.log('Generating video thumbnails...');
      await sleep(2500);
    });

    const transcoded = await step.run('Transcode video', async () => {
      console.log('Transcoding video to multiple formats...');
      await sleep(5000);
      return ['720p', '1080p', '4K'];
    });

    await step.run('Upload to CDN', async () => {
      console.log('Uploading processed video to CDN...');
      await sleep(3000);
    });

    return { 
      success: true, 
      formats: transcoded,
      processingTime: '15.5s'
    };
  }
);

export const dataMigration = createFunction<Events, 'data-migration'>(
  { id: 'data-migration' },
  async ({ event, step }) => {
    let totalMigrated = 0;
    const batches = 5;

    for (let i = 0; i < batches; i++) {
      const batch = await step.run(`Migrate batch ${i + 1}`, async () => {
        await sleep(1000);
        const migrated = event.data.batchSize;
        console.log(`Migrated ${migrated} records in batch ${i + 1}`);
        return migrated;
      });
      totalMigrated += batch;
    }

    await step.run('Verify migration', async () => {
      await sleep(1500);
      console.log('Verifying all migrated data...');
    });

    return { 
      totalRecords: totalMigrated,
      batches,
      status: 'completed'
    };
  }
);

export const emailCampaign = createFunction<Events, 'email-campaign'>(
  { id: 'email-campaign' },
  async ({ event, step }) => {
    const recipients = await step.run('Load recipient list', async () => {
      await sleep(800);
      return event.data.recipientCount;
    });

    const template = await step.run('Generate email template', async () => {
      await sleep(600);
      return { subject: 'Campaign Update', body: 'Hello!' };
    });

    let sent = 0;
    const batches = Math.ceil(recipients / 100);

    for (let i = 0; i < batches; i++) {
      const batchSent = await step.run(`Send batch ${i + 1}`, async () => {
        await sleep(500);
        const count = Math.min(100, recipients - sent);
        console.log(`Sent ${count} emails in batch ${i + 1}`);
        return count;
      });
      sent += batchSent;
    }

    return { 
      campaignId: event.data.campaignId,
      sent,
      template 
    };
  }
);

export const imageResize = createFunction<Events, 'image-resize'>(
  { id: 'image-resize' },
  async ({ event, step }) => {
    await step.run('Download original image', async () => {
      console.log(`Downloading image from ${event.data.imageUrl}`);
      await sleep(1000);
    });

    const resizedImages: string[] = [];

    for (const size of event.data.sizes) {
      const resized = await step.run(`Resize to ${size}px`, async () => {
        await sleep(700);
        console.log(`Resized image to ${size}px`);
        return `${event.data.imageUrl}_${size}px.jpg`;
      });
      resizedImages.push(resized);
    }

    await step.run('Upload resized images', async () => {
      await sleep(1200);
      console.log('Uploaded all resized images');
    });

    return { 
      original: event.data.imageUrl,
      resized: resizedImages 
    };
  }
);

export const webhookRetry = createFunction<Events, 'webhook-retry'>(
  { id: 'webhook-retry' },
  async ({ event, step }) => {
    const maxRetries = 3;
    let attempt = 0;

    const result = await step.run('Send webhook with retries', async () => {
      attempt++;
      
      if (Math.random() < 0.6 && attempt < maxRetries) {
        console.log(`Webhook attempt ${attempt} failed, retrying...`);
        throw new Error('Webhook delivery failed');
      }
      
      console.log(`Webhook delivered successfully on attempt ${attempt}`);
      return { 
        delivered: true, 
        attempts: attempt,
        timestamp: new Date().toISOString()
      };
    });

    await step.run('Log webhook result', async () => {
      await sleep(200);
      console.log('Webhook result logged');
    });

    return result;
  }
);

export const dataValidation = createFunction<Events, 'data-validation'>(
  { id: 'data-validation' },
  async ({ event, step }) => {
    const validRecords: Array<Record<string, any>> = [];
    const invalidRecords: Array<{ record: Record<string, any>; error?: string }> = [];

    for (let i = 0; i < event.data.records.length; i++) {
      const record = event.data.records[i];
      
      const validation = await step.run(`Validate record ${i + 1}`, async () => {
        await sleep(300);
        
        const isValid = Math.random() > 0.3;
        
        if (isValid) {
          console.log(`Record ${i + 1} is valid`);
          return { valid: true, record };
        } else {
          console.log(`Record ${i + 1} failed validation`);
          return { valid: false, record, error: 'Invalid format' };
        }
      });

      if (validation.valid) {
        validRecords.push(validation.record);
      } else {
        invalidRecords.push({ record: validation.record, error: validation.error });
      }
    }

    await step.run('Generate validation report', async () => {
      await sleep(500);
      console.log('Validation report generated');
    });

    return {
      total: event.data.records.length,
      valid: validRecords.length,
      invalid: invalidRecords.length,
      invalidRecords
    };
  }
);

export const reportGeneration = createFunction<Events, 'report-generation'>(
  { id: 'report-generation' },
  async ({ event, step }) => {
    const data = await step.run('Fetch data', async () => {
      console.log(`Fetching data for ${event.data.reportType} report...`);
      await sleep(2000);
      
      if (Math.random() < 0.2) {
        throw new Error('Database timeout - data fetch failed');
      }
      
      return { rows: 1000, columns: 25 };
    });

    const processed = await step.run('Process data', async () => {
      console.log('Processing and aggregating data...');
      await sleep(3000);
      
      if (Math.random() < 0.15) {
        throw new Error('Processing failed - out of memory');
      }
      
      return { aggregates: 50, calculations: 100 };
    });

    await step.run('Generate charts', async () => {
      console.log('Generating charts and visualizations...');
      await sleep(2500);
    });

    const report = await step.run('Create PDF', async () => {
      console.log('Creating PDF report...');
      await sleep(2000);
      return `report_${event.data.reportType}_${Date.now()}.pdf`;
    });

    await step.run('Send notification', async () => {
      await sleep(500);
      console.log('Report generation notification sent');
    });

    return {
      reportType: event.data.reportType,
      filename: report,
      dataPoints: data.rows,
      aggregates: processed.aggregates
    };
  }
);