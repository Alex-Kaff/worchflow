import { createFunction } from '../src';

export type HelloWorldData = {
  email: string;
};

export type ProcessPaymentData = {
  amount: number;
  customerId: string;
};

export type Events = {
  'hello-world': {
    data: HelloWorldData;
  };
  'process-payment': {
    data: ProcessPaymentData;
  };
};

export const helloWorld = createFunction<Events, 'hello-world'>(
  { id: 'hello-world' },
  async ({ event, step }) => {
    const user = await step.run('Fetch user from database', async () => {
      return { id: 1, email: event.data.email, name: 'John Doe' };
    });

    await step.run('Send confirmation email', async () => {
      console.log(`Sending email to ${user.email}`);
    });

    return { message: `Hello ${user.name}!` };
  }
);

export const processPayment = createFunction<Events, 'process-payment'>(
  { id: 'process-payment' },
  async ({ event, step }) => {
    const payment = await step.run('Validate payment details', async () => {
      return { amount: event.data.amount, currency: 'USD' };
    });

    const result = await step.run('Charge payment provider', async () => {
      return { success: true, transactionId: 'txn_123' };
    });

    await step.run('Send receipt email', async () => {
      console.log('Receipt sent');
    });

    return result;
  }
);