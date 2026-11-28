import type { AuthSession, LoginInput, SessionUser } from '../types/auth';
import type {
  ClassSummary,
  CreateClassInput,
  CreateLabInput,
  LabSummary,
  StudentLabDetail,
  TaLabDetail,
} from '../types/lab';
import type { PaginatedResponse } from '../types/problem-details';
import type { ReviewQueueItem, ReviewQueueQuery, TaSubmissionReviewView } from '../types/review';
import type {
  CreateSubmissionInput,
  StudentSubmissionSummary,
  StudentSubmissionView,
  SubmissionAcceptedDto,
} from '../types/submission';

export type ApiMode = 'mock' | 'http';

export interface LeeTkobApiClient {
  readonly mode: ApiMode;

  // Auth
  login(input: LoginInput): Promise<AuthSession>;
  getCurrentUser(token: string): Promise<SessionUser>;

  // Classes
  listClasses(token: string, cursor?: string): Promise<PaginatedResponse<ClassSummary>>;
  createClass(token: string, input: CreateClassInput): Promise<ClassSummary>;

  // Labs
  listClassLabs(
    token: string,
    classId: string,
    cursor?: string,
  ): Promise<PaginatedResponse<LabSummary>>;
  createLab(token: string, classId: string, input: CreateLabInput): Promise<TaLabDetail>;
  getStudentLab(token: string, labId: string): Promise<StudentLabDetail>;
  getTaLab(token: string, labId: string): Promise<TaLabDetail>;

  // Submissions (POST matches docs/contract/post-submissions.md)
  createSubmission(
    token: string,
    labId: string,
    input: CreateSubmissionInput,
    idempotencyKey: string,
  ): Promise<SubmissionAcceptedDto>;
  listMySubmissions(
    token: string,
    labId: string,
    cursor?: string,
  ): Promise<PaginatedResponse<StudentSubmissionSummary>>;
  getStudentSubmission(token: string, submissionId: string): Promise<StudentSubmissionView>;

  // TA Review Queue
  listReviewQueue(
    token: string,
    labId: string,
    query: ReviewQueueQuery,
  ): Promise<PaginatedResponse<ReviewQueueItem>>;
  getTaSubmissionReview(token: string, submissionId: string): Promise<TaSubmissionReviewView>;
}
