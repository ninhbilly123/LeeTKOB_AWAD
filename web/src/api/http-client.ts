import type { AuthSession, LoginInput, SessionUser } from '../types/auth';
import type {
  ClassSummary,
  CreateClassInput,
  CreateLabInput,
  LabSummary,
  StudentLabDetail,
  TaLabDetail,
} from '../types/lab';
import {
  ApiError,
  type PaginatedResponse,
  type Rfc9457ProblemDetails,
} from '../types/problem-details';
import type { ReviewQueueItem, ReviewQueueQuery, TaSubmissionReviewView } from '../types/review';
import type {
  CreateSubmissionInput,
  StudentSubmissionSummary,
  StudentSubmissionView,
  SubmissionAcceptedDto,
} from '../types/submission';
import type { LeeTkobApiClient } from './client.interface';

export class HttpApiClient implements LeeTkobApiClient {
  public readonly mode = 'http' as const;
  private readonly baseUrl: string;

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
      extraHeaders?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      ...(options.extraHeaders ?? {}),
    };

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new ApiError({
        type: 'https://leetkob.edu.vn/errors/network-error',
        title: 'Lỗi kết nối mạng',
        status: 0,
        detail:
          'Không thể kết nối tới máy chủ Gateway. Kiểm tra kết nối mạng và thử lại (nếu đang nộp bài, Idempotency-Key sẽ được giữ nguyên).',
        instance: path,
      });
    }

    if (!response.ok) {
      let problem: Rfc9457ProblemDetails = {
        type: 'https://leetkob.edu.vn/errors/http-error',
        title: response.statusText || 'HTTP Error',
        status: response.status,
        detail: `Yêu cầu thất bại với mã trạng thái ${response.status}.`,
        instance: path,
      };
      try {
        const parsed = (await response.json()) as Partial<Rfc9457ProblemDetails>;
        problem = {
          type: typeof parsed.type === 'string' ? parsed.type : problem.type,
          title: typeof parsed.title === 'string' ? parsed.title : problem.title,
          status: typeof parsed.status === 'number' ? parsed.status : response.status,
          detail: typeof parsed.detail === 'string' ? parsed.detail : problem.detail,
          instance: typeof parsed.instance === 'string' ? parsed.instance : path,
          errors: Array.isArray(parsed.errors) ? parsed.errors : undefined,
        };
      } catch {
        // Fallback to constructed RFC 9457 object when body is not JSON
      }
      throw new ApiError(problem);
    }

    return (await response.json()) as T;
  }

  login(input: LoginInput): Promise<AuthSession> {
    return this.request<AuthSession>('/auth/login', { method: 'POST', body: input });
  }

  getCurrentUser(token: string): Promise<SessionUser> {
    return this.request<SessionUser>('/auth/me', { token });
  }

  listClasses(token: string, cursor?: string): Promise<PaginatedResponse<ClassSummary>> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request<PaginatedResponse<ClassSummary>>(`/classes${qs}`, { token });
  }

  createClass(token: string, input: CreateClassInput): Promise<ClassSummary> {
    return this.request<ClassSummary>('/classes', { method: 'POST', token, body: input });
  }

  listClassLabs(
    token: string,
    classId: string,
    cursor?: string,
  ): Promise<PaginatedResponse<LabSummary>> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request<PaginatedResponse<LabSummary>>(
      `/classes/${encodeURIComponent(classId)}/labs${qs}`,
      { token },
    );
  }

  createLab(token: string, classId: string, input: CreateLabInput): Promise<TaLabDetail> {
    return this.request<TaLabDetail>(`/classes/${encodeURIComponent(classId)}/labs`, {
      method: 'POST',
      token,
      body: input,
    });
  }

  getStudentLab(token: string, labId: string): Promise<StudentLabDetail> {
    return this.request<StudentLabDetail>(`/labs/${encodeURIComponent(labId)}`, { token });
  }

  getTaLab(token: string, labId: string): Promise<TaLabDetail> {
    return this.request<TaLabDetail>(`/labs/${encodeURIComponent(labId)}`, { token });
  }

  createSubmission(
    token: string,
    labId: string,
    input: CreateSubmissionInput,
    idempotencyKey: string,
  ): Promise<SubmissionAcceptedDto> {
    return this.request<SubmissionAcceptedDto>(`/labs/${encodeURIComponent(labId)}/submissions`, {
      method: 'POST',
      token,
      body: input,
      extraHeaders: { 'Idempotency-Key': idempotencyKey },
    });
  }

  listMySubmissions(
    token: string,
    labId: string,
    cursor?: string,
  ): Promise<PaginatedResponse<StudentSubmissionSummary>> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request<PaginatedResponse<StudentSubmissionSummary>>(
      `/labs/${encodeURIComponent(labId)}/submissions/me${qs}`,
      { token },
    );
  }

  getStudentSubmission(token: string, submissionId: string): Promise<StudentSubmissionView> {
    return this.request<StudentSubmissionView>(`/submissions/${encodeURIComponent(submissionId)}`, {
      token,
    });
  }

  listReviewQueue(
    token: string,
    labId: string,
    query: ReviewQueueQuery,
  ): Promise<PaginatedResponse<ReviewQueueItem>> {
    const params = new URLSearchParams();
    params.set('scope', query.scope);
    if (query.bucket && query.bucket !== 'ALL') {
      params.set('bucket', query.bucket);
    }
    if (query.cursor) {
      params.set('cursor', query.cursor);
    }
    return this.request<PaginatedResponse<ReviewQueueItem>>(
      `/labs/${encodeURIComponent(labId)}/review-queue?${params.toString()}`,
      { token },
    );
  }

  getTaSubmissionReview(token: string, submissionId: string): Promise<TaSubmissionReviewView> {
    return this.request<TaSubmissionReviewView>(
      `/submissions/${encodeURIComponent(submissionId)}`,
      { token },
    );
  }
}
