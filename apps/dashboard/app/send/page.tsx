'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function SendEventPage() {
  const router = useRouter();
  const [eventName, setEventName] = useState('');
  const [eventData, setEventData] = useState('{\n  \n}');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = JSON.parse(eventData);
      const result = await api.sendEvent({ name: eventName, data });
      router.push(`/execution/${result.executionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON or network error');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-4">
          <Link href="/" className="text-blue-600 hover:text-blue-800">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h1 className="text-2xl font-bold text-gray-900">Send Event</h1>
            <p className="text-sm text-gray-600 mt-1">
              Create a new workflow execution
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="eventName" className="block text-sm font-medium text-gray-700 mb-2">
                Event Name
              </label>
              <input
                type="text"
                id="eventName"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                placeholder="hello-world"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                The name of the event/function to execute
              </p>
            </div>

            <div>
              <label htmlFor="eventData" className="block text-sm font-medium text-gray-700 mb-2">
                Event Data (JSON)
              </label>
              <textarea
                id="eventData"
                value={eventData}
                onChange={(e) => setEventData(e.target.value)}
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 font-mono text-sm text-gray-900"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                The data to pass to the event handler
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Sending...' : 'Send Event'}
              </button>
              <Link
                href="/"
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-300"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-900 mb-2">Example Events</h3>
          <div className="space-y-2 text-sm text-blue-800">
            <div>
              <strong>hello-world:</strong>
              <code className="ml-2 text-xs">{'{ "email": "user@example.com" }'}</code>
            </div>
            <div>
              <strong>process-payment:</strong>
              <code className="ml-2 text-xs">{'{ "amount": 100, "customerId": "cust_123" }'}</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

