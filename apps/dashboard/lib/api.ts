import type { 
  ExecutionsResponse, 
  StatsResponse, 
  ExecutionDetails, 
  SendEventRequest,
  SendEventResponse,
  RetryResponse 
} from './types';

class ApiClient {
  private baseUrl = '/api';

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `Request failed with status ${response.status}`);
    }
    
    return response.json();
  }

  async getExecutions(status?: string, limit = 50, skip = 0): Promise<ExecutionsResponse> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());
    params.append('skip', skip.toString());
    
    return this.request<ExecutionsResponse>(`/executions?${params}`);
  }

  async getExecution(id: string): Promise<ExecutionDetails> {
    return this.request<ExecutionDetails>(`/executions/${id}`);
  }

  async retryExecution(id: string): Promise<RetryResponse> {
    return this.request<RetryResponse>(`/executions/${id}/retry`, {
      method: 'POST',
    });
  }

  async getStats(): Promise<StatsResponse> {
    return this.request<StatsResponse>('/stats');
  }

  async sendEvent(data: SendEventRequest): Promise<SendEventResponse> {
    return this.request<SendEventResponse>('/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  }
}

export const api = new ApiClient();

