'use client';

import { useEffect, useState, useCallback } from 'react';
import { use } from 'react';
import Link from 'next/link';
import type { ExecutionDetails } from '@/lib/types';
import { api } from '@/lib/api';

export default function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ExecutionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await api.getExecution(id);
      setData(result);
      setError(null);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch execution');
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
    
    // Only poll if execution is not in a final state
    const interval = setInterval(() => {
      if (data?.execution.status === 'completed' || data?.execution.status === 'failed') {
        return;
      }
      fetchData();
    }, 2000);
    
    return () => clearInterval(interval);
  }, [fetchData, data?.execution.status]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'queued': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600 text-center">
          <p className="font-semibold mb-2">Error loading execution</p>
          <p className="text-sm mb-4">{error}</p>
          <Link href="/" className="text-blue-600 hover:text-blue-800">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Execution not found</div>
      </div>
    );
  }

  const { execution, steps } = data;
  let eventData;
  try {
    eventData = JSON.parse(execution.eventData);
  } catch {
    eventData = execution.eventData;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-4">
          <Link href="/" className="text-blue-600 hover:text-blue-800">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow mb-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  {execution.eventName}
                </h1>
                <p className="text-sm text-gray-500 font-mono">{execution.id}</p>
              </div>
              <span className={`px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full ${getStatusColor(execution.status)}`}>
                {execution.status}
              </span>
            </div>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Created</h3>
              <p className="text-sm text-gray-900">{formatDate(execution.createdAt)}</p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-1">Updated</h3>
              <p className="text-sm text-gray-900">{formatDate(execution.updatedAt)}</p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Event Data</h3>
              <pre className="bg-gray-50 p-4 rounded-md overflow-x-auto text-sm text-gray-900">
                {JSON.stringify(eventData, null, 2)}
              </pre>
            </div>

            {execution.result && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Result</h3>
                <pre className="bg-green-50 p-4 rounded-md overflow-x-auto text-sm text-green-900">
                  {JSON.stringify(execution.result, null, 2)}
                </pre>
              </div>
            )}

            {execution.error && (
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Error</h3>
                <div className="bg-red-50 p-4 rounded-md">
                  <p className="text-sm text-red-900 font-medium mb-2">{execution.error}</p>
                  {execution.errorStack && (
                    <pre className="text-xs text-red-800 overflow-x-auto">
                      {execution.errorStack}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {execution.status === 'failed' && (
              <div>
                <button
                  onClick={async () => {
                    try {
                      await api.retryExecution(execution.id);
                      fetchData();
                    } catch (err) {
                      console.error('Failed to retry:', err);
                    }
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
                >
                  Retry Execution
                </button>
              </div>
            )}
          </div>
        </div>

        {steps.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Steps ({steps.length})
              </h2>
            </div>
            <div className="divide-y divide-gray-200">
              {steps.map((step, index) => (
                <div key={step.stepId} className="px-6 py-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mr-2">
                        Step {index + 1}
                      </span>
                      <span className="text-sm text-gray-500 font-mono">
                        {step.stepId}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatDate(step.timestamp)}
                    </span>
                  </div>
                  <pre className="bg-gray-50 p-3 rounded-md overflow-x-auto text-sm text-gray-900 mt-2">
                    {JSON.stringify(step.result, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

