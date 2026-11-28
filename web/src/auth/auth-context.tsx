import React, { useCallback, useMemo, useState } from 'react';
import { useApiClient } from '../api/api-context';
import type { AuthSession, LoginInput } from '../types/auth';
import { AuthContext } from './auth-context-core';

const STORAGE_KEY = 'leetkob.session.v1';

function readStoredSession(): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.accessToken || !parsed.user?.role) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface AuthProviderProps {
  initialSession?: AuthSession | null;
  children: React.ReactNode;
}

export function AuthProvider({ initialSession, children }: AuthProviderProps) {
  const api = useApiClient();
  const [session, setSession] = useState<AuthSession | null>(() =>
    initialSession !== undefined ? initialSession : readStoredSession(),
  );
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null);

  const login = useCallback(
    async (input: LoginInput) => {
      const next = await api.login(input);
      setSession(next);
      setExpiredMessage(null);
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage restrictions
      }
      return next;
    },
    [api],
  );

  const logout = useCallback(() => {
    setSession(null);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      login,
      logout,
      expiredMessage,
      setExpiredMessage,
    }),
    [session, login, logout, expiredMessage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
