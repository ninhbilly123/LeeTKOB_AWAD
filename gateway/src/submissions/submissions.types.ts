/**
 * Submission entity interfaces and RFC 9457 Problem Details definitions
 * Compliant with docs/contract/post-submissions.md and specs/001-submission-contract-api/data-model.md
 */

export type UserRole = 'STUDENT' | 'TA' | 'ADMIN';

export type SubmissionStatus = 'QUEUED' | 'JUDGING' | 'ACCEPTED' | 'WRONGFUL_DEDUCTION' | 'REJECTED';

export type EnrollmentStatus = 'ACTIVE' | 'DROPPED';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  classIds: string[];
}

export interface Lab {
  id: string;
  classId: string;
  title: string;
  deadline: string; // ISO 8601 string
  maxPayloadSize: number; // default: 65,536 bytes (64 KB)
  isActive: boolean;
}

export interface ClassMembership {
  id: string;
  studentId: string;
  classId: string;
  status: EnrollmentStatus;
}

export interface Submission {
  id: string;
  labId: string;
  studentId: string;
  code: string;
  status: SubmissionStatus;
  submittedAt: string; // ISO 8601 string
  idempotencyKey: string;
}

export interface IdempotencyRecord {
  key: string;
  studentId: string;
  labId: string;
  payloadHash: string; // SHA-256 hex string
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: Record<string, any>;
  createdAt: string;
  expiresAt: string;
}

export interface Rfc9457ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

