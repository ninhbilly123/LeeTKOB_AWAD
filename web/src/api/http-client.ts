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
import type {
  ConstraintVerdictDetail,
  ReviewQueueBucket,
  ReviewQueueItem,
  ReviewQueueQuery,
  TaSubmissionReviewView,
  UnsureReason,
} from '../types/review';
import type {
  CreateSubmissionInput,
  JudgeVerdict,
  StudentSubmissionSummary,
  StudentSubmissionView,
  SubmissionAcceptedDto,
  SubmissionPipelineStatus,
} from '../types/submission';
import type { LeeTkobApiClient } from './client.interface';

interface GatewayUserDto {
  id: string;
  username?: string;
  email?: string;
  displayName?: string;
  role: SessionUser['role'];
  classIds?: string[];
}

interface GatewayLabDto {
  id: string;
  classId: string;
  classCode?: string;
  title: string;
  statement?: string;
  openedAt?: string;
  deadline: string;
  cpuTimeLimitSec?: number;
  memoryLimitMb?: number;
  maxPayloadSize?: number;
  maxCodeBytes?: number;
  publishedAt?: string | null;
  testCases?: Array<{
    id: string;
    ordinal?: number;
    isHidden?: boolean;
    isSample?: boolean;
    input: string;
    expectedOutput: string;
  }>;
  sampleTests?: Array<{ ordinal: number; input: string; expectedOutput: string }>;
  constraints?: Array<{
    id: string;
    code?: string;
    checkType?: string;
    type?: string;
    text?: string;
    description?: string;
    banPatterns?: string[];
    patterns?: string[];
    deduction: number;
  }>;
}

interface GatewaySubmissionSummaryDto {
  id: string;
  labId: string;
  studentId: string;
  status: SubmissionPipelineStatus;
  overallVerdict: JudgeVerdict | null;
  passedTests: number;
  totalTests: number;
  maxTimeMs?: number | null;
  maxMemoryKb?: number | null;
  isCounting?: boolean;
  isCountedForGrade?: boolean;
  submittedAt: string;
}

interface GatewayStudentSubmissionDto extends GatewaySubmissionSummaryDto {
  code?: string;
  compileOutput?: string | null;
  isPublished?: boolean;
  publishedAt?: string;
  testVerdicts?: Array<{ ordinal: number; verdict: JudgeVerdict; timeMs?: number | null }>;
  finalScore?: number;
  deductions?: Array<{
    constraintCode: string;
    constraintText: string;
    deduction: number;
    evidence: Array<{ line: number; text: string }>;
    reason: string | null;
  }>;
}

interface GatewayReviewFindingDto {
  findingId: string;
  submissionId: string;
  studentId: string;
  isCounting: boolean;
  submittedAt: string;
  constraintId: string;
  constraintCode: string;
  constraintText: string;
  configuredDeduction: number;
  proposedDeduction: number;
  source: 'HARD_RULE' | 'LLM';
  verdict: 'pass' | 'violation' | 'unsure';
  unsureReason: string | null;
  evidence: Array<{ line: number; text: string }>;
  reason: string | null;
}

interface GatewayTaReviewResponseDto {
  submission: {
    id: string;
    labId: string;
    studentId: string;
    code: string;
    status: SubmissionPipelineStatus;
    overallVerdict: JudgeVerdict | null;
    checkerStatus?: 'NOT_APPLICABLE' | 'PENDING' | 'COMPLETED';
    passedTests?: number;
    totalTests?: number;
    maxTimeMs?: number | null;
    maxMemoryKb?: number | null;
    isCounting?: boolean;
    submittedAt: string;
  };
  testVerdicts: Array<{ ordinal: number; verdict: JudgeVerdict; timeMs?: number | null }>;
  findings: GatewayReviewFindingDto[];
}

function decodeJwtExpiryIso(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const parsed = JSON.parse(atob(padded)) as { exp?: number };
      if (typeof parsed.exp === 'number') {
        return new Date(parsed.exp * 1000).toISOString();
      }
    }
  } catch {
    // Fallback below
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function mapUnsureReason(raw: string | null): UnsureReason | null {
  if (!raw) return null;
  switch (raw) {
    case 'SCHEMA_INVALID':
    case 'EVIDENCE_MISMATCH':
    case 'PARSE_FAILURE':
      return 'PARSE_FAILURE';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'COST_CAP_EXCEEDED':
    case 'BUDGET_EXCEEDED':
      return 'BUDGET_EXCEEDED';
    default:
      return 'LOW_CONFIDENCE';
  }
}

function deriveQueueBucket(findings: GatewayReviewFindingDto[]): ReviewQueueBucket {
  if (findings.some((f) => f.source === 'HARD_RULE' && f.verdict === 'violation')) {
    return 'HARD_RULE_VIOLATION';
  }
  if (findings.some((f) => f.source === 'LLM' && f.verdict === 'violation')) {
    return 'LLM_VIOLATION';
  }
  if (findings.some((f) => f.verdict === 'unsure')) {
    return 'UNSURE';
  }
  return 'PASS_SAMPLE_10PCT';
}

function mapGatewayUser(dto: GatewayUserDto): SessionUser {
  return {
    id: dto.id,
    email: dto.email ?? (dto.username ? `${dto.username}@leetkob.edu.vn` : dto.id),
    displayName: dto.displayName ?? dto.username ?? dto.email ?? dto.id,
    role: dto.role,
    classIds: dto.classIds ?? [],
  };
}

function mapToStudentLab(dto: GatewayLabDto): StudentLabDetail {
  const sampleTests = dto.sampleTests
    ? dto.sampleTests
    : (dto.testCases ?? [])
        .filter((tc) => (tc.isSample !== undefined ? tc.isSample : !tc.isHidden))
        .map((tc, idx) => ({
          ordinal: tc.ordinal ?? idx + 1,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
        }));

  return {
    id: dto.id,
    classId: dto.classId,
    classCode: dto.classCode ?? dto.classId,
    title: dto.title,
    statement: dto.statement ?? '',
    openedAt: dto.openedAt ?? dto.deadline,
    deadline: dto.deadline,
    cpuTimeLimitSec: dto.cpuTimeLimitSec ?? 1,
    memoryLimitMb: dto.memoryLimitMb ?? 256,
    maxCodeBytes: dto.maxCodeBytes ?? dto.maxPayloadSize ?? 65536,
    publishedAt: dto.publishedAt ?? null,
    sampleTests,
    constraints: (dto.constraints ?? []).map((c) => ({
      id: c.id,
      code: c.code ?? c.id,
      description: c.description ?? c.text ?? '',
      deduction: c.deduction,
    })),
  };
}

function mapToTaLab(dto: GatewayLabDto): TaLabDetail {
  return {
    id: dto.id,
    classId: dto.classId,
    classCode: dto.classCode ?? dto.classId,
    title: dto.title,
    statement: dto.statement ?? '',
    openedAt: dto.openedAt ?? dto.deadline,
    deadline: dto.deadline,
    cpuTimeLimitSec: dto.cpuTimeLimitSec ?? 1,
    memoryLimitMb: dto.memoryLimitMb ?? 256,
    maxCodeBytes: dto.maxCodeBytes ?? dto.maxPayloadSize ?? 65536,
    publishedAt: dto.publishedAt ?? null,
    testCases: (dto.testCases ?? []).map((tc, idx) => ({
      id: tc.id,
      ordinal: tc.ordinal ?? idx + 1,
      isSample: tc.isSample !== undefined ? tc.isSample : !tc.isHidden,
      input: tc.input,
      expectedOutput: tc.expectedOutput,
    })),
    constraints: (dto.constraints ?? []).map((c) => ({
      id: c.id,
      code: c.code ?? c.id,
      type: c.type === 'BAN_LIST' || c.checkType === 'HARD_RULE' ? 'BAN_LIST' : 'SEMANTIC_LLM',
      description: c.description ?? c.text ?? '',
      patterns: c.patterns ?? c.banPatterns ?? [],
      deduction: c.deduction,
    })),
  };
}

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

  async login(input: LoginInput): Promise<AuthSession> {
    const res = await this.request<{
      accessToken: string;
      expiresAt?: string;
      user: GatewayUserDto;
    }>('/auth/login', {
      method: 'POST',
      body: {
        email: input.email.trim(),
        username: input.email.trim(),
        password: input.password,
      },
    });

    let profile = mapGatewayUser(res.user);
    if (!res.user.email || !res.user.displayName) {
      try {
        profile = await this.getCurrentUser(res.accessToken);
      } catch {
        // Keep mapped profile from login response
      }
    }

    return {
      accessToken: res.accessToken,
      expiresAt: res.expiresAt ?? decodeJwtExpiryIso(res.accessToken),
      user: profile,
    };
  }

  async getCurrentUser(token: string): Promise<SessionUser> {
    const dto = await this.request<GatewayUserDto>('/auth/me', { token });
    return mapGatewayUser(dto);
  }

  listClasses(token: string, cursor?: string): Promise<PaginatedResponse<ClassSummary>> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request<PaginatedResponse<ClassSummary>>(`/classes${qs}`, { token });
  }

  createClass(token: string, input: CreateClassInput): Promise<ClassSummary> {
    return this.request<ClassSummary>('/classes', { method: 'POST', token, body: input });
  }

  async listClassLabs(
    token: string,
    classId: string,
    cursor?: string,
  ): Promise<PaginatedResponse<LabSummary>> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const page = await this.request<PaginatedResponse<GatewayLabDto>>(
      `/classes/${encodeURIComponent(classId)}/labs${qs}`,
      { token },
    );
    return {
      items: page.items.map((lab) => ({
        id: lab.id,
        classId: lab.classId,
        classCode: lab.classCode ?? lab.classId,
        title: lab.title,
        openedAt: lab.openedAt ?? lab.deadline,
        deadline: lab.deadline,
        publishedAt: lab.publishedAt ?? null,
        submissionCount: 0,
        pendingReviewCount: 0,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async createLab(token: string, classId: string, input: CreateLabInput): Promise<TaLabDetail> {
    const payload = {
      classId,
      title: input.title,
      statement: input.statement,
      openedAt: input.openedAt,
      deadline: input.deadline,
      cpuTimeLimitSec: input.cpuTimeLimitSec,
      memoryLimitMb: input.memoryLimitMb,
      testCases: input.testCases.map((tc, idx) => ({
        id: `tc_${tc.ordinal ?? idx + 1}`,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isHidden: !tc.isSample,
      })),
      constraints: input.constraints.map((c) => ({
        id: c.code.trim(),
        code: c.code.trim(),
        checkType: c.type === 'BAN_LIST' ? 'HARD_RULE' : 'LLM',
        text: c.description.trim(),
        banPatterns: c.patterns,
        deduction: c.deduction,
      })),
    };
    const created = await this.request<GatewayLabDto>(
      `/classes/${encodeURIComponent(classId)}/labs`,
      {
        method: 'POST',
        token,
        body: payload,
      },
    );
    return mapToTaLab(created);
  }

  async getStudentLab(token: string, labId: string): Promise<StudentLabDetail> {
    const dto = await this.request<GatewayLabDto>(`/labs/${encodeURIComponent(labId)}`, { token });
    return mapToStudentLab(dto);
  }

  async getTaLab(token: string, labId: string): Promise<TaLabDetail> {
    const dto = await this.request<GatewayLabDto>(`/labs/${encodeURIComponent(labId)}`, { token });
    return mapToTaLab(dto);
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

  async listMySubmissions(
    token: string,
    labId: string,
    cursor?: string,
  ): Promise<PaginatedResponse<StudentSubmissionSummary>> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const res = await this.request<{
      submissions?: GatewaySubmissionSummaryDto[];
      items?: GatewaySubmissionSummaryDto[];
      nextCursor?: string | null;
    }>(`/labs/${encodeURIComponent(labId)}/submissions${query}`, { token });
    const rawItems = res.submissions ?? res.items ?? [];
    return {
      items: rawItems.map((s) => ({
        id: s.id,
        labId: s.labId,
        submittedAt: s.submittedAt,
        status: s.status,
        overallVerdict: s.overallVerdict ?? null,
        passedTests: s.passedTests ?? 0,
        totalTests: s.totalTests ?? 0,
        maxTimeMs: s.maxTimeMs ?? null,
        maxMemoryKb: s.maxMemoryKb ?? null,
        isCountedForGrade: Boolean(s.isCountedForGrade ?? s.isCounting),
      })),
      nextCursor: res.nextCursor ?? null,
    };
  }

  async getStudentSubmission(token: string, submissionId: string): Promise<StudentSubmissionView> {
    const dto = await this.request<GatewayStudentSubmissionDto>(
      `/submissions/${encodeURIComponent(submissionId)}`,
      { token },
    );

    const publishedGrade =
      dto.isPublished && dto.finalScore !== undefined
        ? {
            rawScore: dto.overallVerdict === 'AC' ? 10 : 0,
            totalDeductions: (dto.deductions ?? []).reduce((sum, d) => sum + d.deduction, 0),
            finalScore: dto.finalScore,
            publishedAt: dto.publishedAt ?? dto.submittedAt,
            confirmedDeductions: (dto.deductions ?? []).map((d) => ({
              constraintCode: d.constraintCode,
              description: d.constraintText,
              deduction: d.deduction,
              evidenceLines: d.evidence.map((e) => e.line),
              taNote: d.reason ?? undefined,
            })),
          }
        : null;

    return {
      id: dto.id,
      labId: dto.labId,
      studentId: dto.studentId,
      submittedAt: dto.submittedAt,
      status: dto.status,
      overallVerdict: dto.overallVerdict ?? null,
      passedTests: dto.passedTests ?? 0,
      totalTests: dto.totalTests ?? 0,
      maxTimeMs: dto.maxTimeMs ?? null,
      maxMemoryKb: dto.maxMemoryKb ?? null,
      isCountedForGrade: Boolean(dto.isCountedForGrade ?? dto.isCounting),
      code: dto.code ?? '',
      compileOutput: dto.compileOutput ?? null,
      testVerdicts: (dto.testVerdicts ?? []).map((t) => ({
        ordinal: t.ordinal,
        verdict: t.verdict,
        timeMs: t.timeMs ?? undefined,
      })),
      publishedGrade,
    };
  }

  async listReviewQueue(
    token: string,
    labId: string,
    query: ReviewQueueQuery,
  ): Promise<PaginatedResponse<ReviewQueueItem>> {
    const params = new URLSearchParams();
    params.set('scope', query.scope);
    const res = await this.request<{ items: GatewayReviewFindingDto[] }>(
      `/labs/${encodeURIComponent(labId)}/review-queue?${params.toString()}`,
      { token },
    );

    // Group per-finding rows from D2 API by submissionId for the 3-column TA workbench
    const bySub = new Map<string, GatewayReviewFindingDto[]>();
    for (const item of res.items ?? []) {
      const list = bySub.get(item.submissionId) ?? [];
      list.push(item);
      bySub.set(item.submissionId, list);
    }

    const grouped: ReviewQueueItem[] = [...bySub.entries()].map(([submissionId, findings]) => {
      const first = findings[0];
      const bucket = deriveQueueBucket(findings);
      const violationCount = findings.filter((f) => f.verdict === 'violation').length;
      const unsureCount = findings.filter((f) => f.verdict === 'unsure').length;
      return {
        submissionId,
        labId,
        studentId: first.studentId,
        studentName: first.studentId,
        submittedAt: first.submittedAt,
        isCountedForGrade: first.isCounting,
        overallVerdict: 'AC',
        checkerStatus: 'COMPLETED',
        queueBucket: bucket,
        summaryLabel:
          violationCount > 0
            ? `${violationCount} vi phạm`
            : unsureCount > 0
              ? `${unsureCount} cần TA xem`
              : 'Mẫu 10% pass',
        violationCount,
        unsureCount,
        maxTimeMs: null,
        maxMemoryKb: null,
      };
    });

    const filtered =
      query.bucket && query.bucket !== 'ALL'
        ? grouped.filter((g) => g.queueBucket === query.bucket)
        : grouped;

    return { items: filtered, nextCursor: null };
  }

  async getTaSubmissionReview(
    token: string,
    submissionId: string,
  ): Promise<TaSubmissionReviewView> {
    const dto = await this.request<GatewayTaReviewResponseDto>(
      `/submissions/${encodeURIComponent(submissionId)}`,
      { token },
    );
    const findings: ConstraintVerdictDetail[] = (dto.findings ?? []).map((f) => ({
      constraintId: f.constraintId,
      code: f.constraintCode,
      description: f.constraintText,
      source: f.source,
      verdict: f.verdict,
      unsureReason: mapUnsureReason(f.unsureReason),
      taConfiguredDeduction: f.configuredDeduction,
      proposedDeduction: f.proposedDeduction,
      rationale: f.reason ?? '',
      evidence: (f.evidence ?? []).map((e) => ({
        lineStart: e.line,
        lineEnd: e.line,
        snippet: e.text,
      })),
    }));

    return {
      submissionId: dto.submission.id,
      labId: dto.submission.labId,
      labTitle: dto.submission.labId,
      publishedAt: null,
      studentId: dto.submission.studentId,
      studentName: dto.submission.studentId,
      submittedAt: dto.submission.submittedAt,
      isCountedForGrade: Boolean(dto.submission.isCounting),
      overallVerdict: dto.submission.overallVerdict ?? 'AC',
      passedTests: dto.submission.passedTests ?? 0,
      totalTests: dto.submission.totalTests ?? 0,
      maxTimeMs: dto.submission.maxTimeMs ?? null,
      maxMemoryKb: dto.submission.maxMemoryKb ?? null,
      code: dto.submission.code,
      testVerdicts: (dto.testVerdicts ?? []).map((t) => ({
        ordinal: t.ordinal,
        verdict: t.verdict,
        timeMs: t.timeMs ?? undefined,
      })),
      checkerStatus: dto.submission.checkerStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING',
      queueBucket: deriveQueueBucket(dto.findings ?? []),
      constraintVerdicts: findings,
    };
  }
}
