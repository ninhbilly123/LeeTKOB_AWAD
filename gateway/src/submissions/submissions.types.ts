import { Request } from 'express';

/**
 * Submission entity interfaces and RFC 9457 Problem Details definitions
 * Compliant with docs/contract/post-submissions.md and specs/001-submission-contract-api/data-model.md
 */

export type UserRole = 'STUDENT' | 'TA' | 'ADMIN';

export type SubmissionStatus =
  'QUEUED' | 'JUDGING' | 'ACCEPTED' | 'WRONGFUL_DEDUCTION' | 'REJECTED';

export type EnrollmentStatus = 'ACTIVE' | 'DROPPED';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  classIds: string[];
}

export interface StoredUser extends AuthenticatedUser {
  username: string;
  passwordHash: string;
}

export type UserProfile = Omit<StoredUser, 'passwordHash'>;

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  receivedAt: number;
}

export interface LabTestCase {
  id: string;
  input: string;
  expectedOutput: string;
  isHidden: boolean;
}

export interface LabConstraint {
  id: string;
  text: string;
  deduction: number;
}

export interface Lab {
  id: string;
  classId: string;
  title: string;
  statement?: string;
  deadline: string; // ISO 8601 string
  maxPayloadSize: number; // default: 65,536 bytes (64 KB)
  isActive: boolean;
  testCases?: LabTestCase[];
  constraints?: LabConstraint[];
  isPublished?: boolean;
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
  isCounting?: boolean;
  submittedAt: string; // ISO 8601 string
  idempotencyKey: string;
}

export type SubmissionResponse = Omit<Submission, 'code' | 'isCounting'>;

export interface SubmissionJobLimits {
  cpuTimeSec: number;
  wallTimeSec: number;
  memoryMb: number;
  maxProcesses: number;
  outputLimitBytes: number;
}

export const DEFAULT_SUBMISSION_LIMITS: SubmissionJobLimits = {
  cpuTimeSec: 1,
  wallTimeSec: 3,
  memoryMb: 256,
  maxProcesses: 16,
  outputLimitBytes: 1048576,
};

export type SubmissionJobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface SubmissionJob {
  id: string;
  submissionId: string;
  labId: string;
  studentId: string;
  code: string;
  submittedAt: string;
  limits: SubmissionJobLimits;
  testCases: Array<{ id: string; input: string; expectedOutput: string }>;
  constraints: LabConstraint[];
  status: SubmissionJobStatus;
  createdAt: string;
}

export interface IdempotencyRecord {
  key: string;
  studentId: string;
  labId: string;
  payloadHash: string; // SHA-256 hex string
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBody: SubmissionResponse;
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
