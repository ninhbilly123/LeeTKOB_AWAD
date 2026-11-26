import type { JudgeVerdict, StudentTestVerdict } from './submission';

export type ConstraintCheckVerdict = 'pass' | 'violation' | 'unsure';
export type ConstraintCheckSource = 'HARD_RULE' | 'LLM';

/**
 * Explicit unsure causes per FAQ-09.
 */
export type UnsureReason = 'PARSE_FAILURE' | 'TIMEOUT' | 'BUDGET_EXCEEDED' | 'LOW_CONFIDENCE';

/**
 * Review queue priority buckets per FAQ-10 and Proposal §3.1 (F1-F2).
 */
export type ReviewQueueBucket =
  'HARD_RULE_VIOLATION' | 'LLM_VIOLATION' | 'UNSURE' | 'PASS_SAMPLE_10PCT';

export type ReviewScope = 'counted' | 'all';

export interface EvidenceSpan {
  lineStart: number;
  lineEnd: number;
  snippet: string;
}

export interface ConstraintVerdictDetail {
  constraintId: string;
  code: string;
  description: string;
  source: ConstraintCheckSource;
  verdict: ConstraintCheckVerdict;
  unsureReason: UnsureReason | null;
  taConfiguredDeduction: number;
  proposedDeduction: number;
  rationale: string;
  evidence: EvidenceSpan[];
}

export interface ReviewQueueQuery {
  scope: ReviewScope;
  bucket?: ReviewQueueBucket | 'ALL';
  cursor?: string;
}

export interface ReviewQueueItem {
  submissionId: string;
  labId: string;
  studentId: string;
  studentName: string;
  submittedAt: string;
  isCountedForGrade: boolean;
  overallVerdict: JudgeVerdict;
  checkerStatus: 'PENDING' | 'COMPLETED';
  queueBucket: ReviewQueueBucket;
  summaryLabel: string;
  violationCount: number;
  unsureCount: number;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
}

/**
 * TA-only submission review detail. Never returned to STUDENT accounts before Publish.
 */
export interface TaSubmissionReviewView {
  submissionId: string;
  labId: string;
  labTitle: string;
  publishedAt: string | null;
  studentId: string;
  studentName: string;
  submittedAt: string;
  isCountedForGrade: boolean;
  overallVerdict: JudgeVerdict;
  passedTests: number;
  totalTests: number;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  code: string;
  testVerdicts: StudentTestVerdict[];
  checkerStatus: 'PENDING' | 'COMPLETED';
  queueBucket: ReviewQueueBucket;
  constraintVerdicts: ConstraintVerdictDetail[];
}
