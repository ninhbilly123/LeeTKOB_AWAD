export type UserRole = 'STUDENT' | 'TA' | 'ADMIN';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  classIds: string[];
}

export interface AuthSession {
  accessToken: string;
  expiresAt: string;
  user: SessionUser;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface DemoAccount {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  summary: string;
}
