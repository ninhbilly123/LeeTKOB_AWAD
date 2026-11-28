import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiClient } from '../api/api-context';
import type { ApiMode } from '../api/client.interface';
import type { AuthSession, LoginInput } from '../types/auth';
import { isApiError } from '../types/problem-details';
import { AuthContext } from './auth-context-core';

function storageKeyForMode(mode: ApiMode): string {
  return mode === 'http' ? 'leetkob.session.v1.http' : 'leetkob.session.v1';
}

function readStoredSession(storageKey: string): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.accessToken || !parsed.user?.role) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      window.sessionStorage.removeItem(storageKey);
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
  const storageKey = storageKeyForMode(api.mode);
  const [session, setSession] = useState<AuthSession | null>(() =>
    initialSession !== undefined ? initialSession : readStoredSession(storageKey),
  );
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null);
  const restoredTokenRef = useRef<string | null>(
    initialSession === undefined ? (session?.accessToken ?? null) : null,
  );

  // Verify restored HTTP session against GET /auth/me on startup so stale/invalid tokens clear cleanly
  useEffect(() => {
    const tokenToVerify = restoredTokenRef.current;
    if (api.mode !== 'http' || !tokenToVerify) {
      return;
    }
    restoredTokenRef.current = null;
    let cancelled = false;
    void api
      .getCurrentUser(tokenToVerify)
      .then((freshUser) => {
        if (cancelled) return;
        setSession((prev) => {
          if (!prev || prev.accessToken !== tokenToVerify) return prev;
          const updated: AuthSession = { ...prev, user: freshUser };
          try {
            window.sessionStorage.setItem(storageKey, JSON.stringify(updated));
          } catch {
            // Ignore storage restrictions
          }
          return updated;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isApiError(err) && err.status === 401) {
          setSession(null);
          setExpiredMessage('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
          try {
            window.sessionStorage.removeItem(storageKey);
          } catch {
            // Ignore storage restrictions
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, storageKey]);

  const login = useCallback(
    async (input: LoginInput) => {
      const next = await api.login(input);
      restoredTokenRef.current = null;
      setSession(next);
      setExpiredMessage(null);
      try {
        window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Ignore storage restrictions
      }
      return next;
    },
    [api, storageKey],
  );

  const logout = useCallback(() => {
    restoredTokenRef.current = null;
    setSession(null);
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage restrictions
    }
  }, [storageKey]);

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
