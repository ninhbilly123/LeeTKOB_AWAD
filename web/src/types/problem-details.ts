export interface FieldValidationError {
  field: string;
  message: string;
}

/**
 * RFC 9457 Problem Details (application/problem+json).
 * Aligned with docs/contract/post-submissions.md and docs/engineering-rules.md (Session 05).
 */
export interface Rfc9457ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  errors?: FieldValidationError[];
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export class ApiError extends Error {
  public readonly problem: Rfc9457ProblemDetails;

  constructor(problem: Rfc9457ProblemDetails) {
    super(problem.detail || problem.title);
    this.name = 'ApiError';
    this.problem = problem;
  }

  get status(): number {
    return this.problem.status;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
