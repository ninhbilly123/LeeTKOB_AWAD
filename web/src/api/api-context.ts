import { createContext, useContext } from 'react';
import type { LeeTkobApiClient } from './client.interface';
import { HttpApiClient } from './http-client';
import { MockApiClient } from './mock-client';

export const ApiClientContext = createContext<LeeTkobApiClient | null>(null);

export function createDefaultApiClient(): LeeTkobApiClient {
  const mode = (import.meta.env.VITE_API_MODE ?? 'mock').toLowerCase();
  if (mode === 'http') {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
    return new HttpApiClient(baseUrl);
  }
  return new MockApiClient();
}

export function useApiClient(): LeeTkobApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error('useApiClient must be used inside ApiClientProvider');
  }
  return client;
}
