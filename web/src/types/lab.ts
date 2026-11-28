import type { JudgeVerdict } from './submission';

export const MAX_CPP_CODE_BYTES = 65536; // Fixed 64 KiB limit per FAQ-05 & post-submissions.md
export const DEFAULT_CPU_LIMIT_SEC = 1; // 1–5s per FAQ-05
export const DEFAULT_MEMORY_LIMIT_MB = 256; // 64–512 MB per FAQ-05

export interface ClassSummary {
  id: string;
  code: string;
  name: string;
  term: string;
  taIds: string[];
  studentCount: number;
  labCount: number;
}

export interface CreateClassInput {
  code: string;
  name: string;
  term: string;
  taIds: string[];
}

export interface TestCaseInput {
  ordinal: number;
  isSample: boolean;
  input: string;
  expectedOutput: string;
}

export interface SampleTestCase {
  ordinal: number;
  input: string;
  expectedOutput: string;
}

export type ConstraintType = 'BAN_LIST' | 'SEMANTIC_LLM';

export interface ConstraintInput {
  code: string;
  type: ConstraintType;
  description: string;
  patterns: string[];
  deduction: number;
}

export interface PublicConstraint {
  id: string;
  code: string;
  description: string;
  deduction: number;
}

export interface TaConstraint extends PublicConstraint {
  type: ConstraintType;
  patterns: string[];
}

export interface LabSummary {
  id: string;
  classId: string;
  classCode: string;
  title: string;
  openedAt: string;
  deadline: string;
  publishedAt: string | null;
  submissionCount: number;
  pendingReviewCount: number;
  latestStudentVerdict?: JudgeVerdict | null;
}

export interface CreateLabInput {
  title: string;
  statement: string;
  openedAt: string;
  deadline: string;
  cpuTimeLimitSec: number;
  memoryLimitMb: number;
  testCases: TestCaseInput[];
  constraints: ConstraintInput[];
}

/**
 * Student-safe lab detail (FAQ-02, FAQ-05, FAQ-06):
 * Contains only sample tests from the problem statement and public constraint descriptions/deductions.
 */
export interface StudentLabDetail {
  id: string;
  classId: string;
  classCode: string;
  title: string;
  statement: string;
  openedAt: string;
  deadline: string;
  cpuTimeLimitSec: number;
  memoryLimitMb: number;
  maxCodeBytes: number;
  publishedAt: string | null;
  sampleTests: SampleTestCase[];
  constraints: PublicConstraint[];
}

/**
 * TA/Admin lab detail: includes hidden test cases and internal constraint patterns.
 */
export interface TaLabDetail extends Omit<StudentLabDetail, 'sampleTests' | 'constraints'> {
  testCases: Array<TestCaseInput & { id: string }>;
  constraints: TaConstraint[];
}
