import { createContext, useContext } from 'react';
import type { AuthSession, LoginInput, UserRole } from '../types/auth';

export interface AuthContextValue {
  session: AuthSession | null;
  login: (input: LoginInput) => Promise<AuthSession>;
  logout: () => void;
  setExpiredMessage: (message: string | null) => void;
  expiredMessage: string | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}

export function defaultHomePathForRole(role: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return '/admin/classes';
    case 'TA':
      return '/ta/classes';
    case 'STUDENT':
      return '/student/labs';
  }
}
