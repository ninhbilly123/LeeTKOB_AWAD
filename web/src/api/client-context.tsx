import React, { useMemo } from 'react';
import { ApiClientContext, createDefaultApiClient } from './api-context';
import type { LeeTkobApiClient } from './client.interface';

interface ApiClientProviderProps {
  client?: LeeTkobApiClient;
  children: React.ReactNode;
}

export function ApiClientProvider({ client, children }: ApiClientProviderProps) {
  const resolved = useMemo(() => client ?? createDefaultApiClient(), [client]);
  return <ApiClientContext.Provider value={resolved}>{children}</ApiClientContext.Provider>;
}
