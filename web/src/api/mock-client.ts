import type { AuthSession, LoginInput, SessionUser } from '../types/auth';
import {
  MAX_CPP_CODE_BYTES,
  type ClassSummary,
  type CreateClassInput,
  type CreateLabInput,
  type LabSummary,
  type StudentLabDetail,
  type TaLabDetail,
} from '../types/lab';
import {
  ApiError,
  type FieldValidationError,
  type PaginatedResponse,
} from '../types/problem-details';
import type {
  ConstraintVerdictDetail,
  EvidenceSpan,
  ReviewQueueBucket,
  ReviewQueueItem,
  ReviewQueueQuery,
  TaSubmissionReviewView,
} from '../types/review';
import type {
  CreateSubmissionInput,
  JudgeVerdict,
  StudentSubmissionSummary,
  StudentSubmissionView,
  SubmissionAcceptedDto,
} from '../types/submission';
import { isValidUuidV4 } from '../utils/idempotency';
import { utf8ByteLength } from '../utils/utf8';
import type { LeeTkobApiClient } from './client.interface';
import { createInitialSeed, type MockInternalSubmission, type MockUserRecord } from './mock-seed';

export interface MockApiClientOptions {
  /** Delay (ms) before simulated QUEUED -> JUDGING -> COMPLETED transitions. Use 0 in unit tests. */
  judgeStepDelayMs?: number;
  /** Optional hook to simulate a one-shot 500 error for retry/idempotency testing. */
  failNextSubmitCount?: number;
}

interface IdempotencyEntry {
  key: string;
  studentId: string;
  labId: string;
  code: string;
  response: SubmissionAcceptedDto;
}

function problemError(
  status: number,
  slug: string,
  title: string,
  detail: string,
  instance: string,
  errors?: FieldValidationError[],
): ApiError {
  return new ApiError({
    type: `https://leetkob.edu.vn/errors/${slug}`,
    title,
    status,
    detail,
    instance,
    errors,
  });
}

function findMatchingLines(code: string, patterns: string[]): EvidenceSpan[] {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const spans: EvidenceSpan[] = [];
  lines.forEach((lineText, idx) => {
    const matched = patterns.some((p) => p.trim() !== '' && lineText.includes(p.trim()));
    if (matched) {
      spans.push({
        lineStart: idx + 1,
        lineEnd: idx + 1,
        snippet: lineText.trim(),
      });
    }
  });
  return spans;
}

function evaluateMockConstraints(
  code: string,
  lab: TaLabDetail,
): { bucket: ReviewQueueBucket; verdicts: ConstraintVerdictDetail[] } {
  const verdicts: ConstraintVerdictDetail[] = lab.constraints.map((constraint) => {
    if (constraint.type === 'BAN_LIST') {
      const evidence = findMatchingLines(code, constraint.patterns);
      const isViolation = evidence.length > 0;
      return {
        constraintId: constraint.id,
        code: constraint.code,
        description: constraint.description,
        source: 'HARD_RULE',
        verdict: isViolation ? 'violation' : 'pass',
        unsureReason: null,
        taConfiguredDeduction: constraint.deduction,
        proposedDeduction: isViolation ? constraint.deduction : 0,
        rationale: isViolation
          ? `Phát hiện biểu thức bị cấm trong mã nguồn (${evidence.map((e) => `dòng ${e.lineStart}`).join(', ')}).`
          : 'Không phát hiện thư viện hoặc hàm bị cấm theo quy tắc cứng.',
        evidence,
      };
    }

    // Heuristic mock for semantic constraint (for offline UI preview only)
    const lower = code.toLowerCase();
    if (lower.includes('mock_unsure') || code.split('\n').length < 6) {
      return {
        constraintId: constraint.id,
        code: constraint.code,
        description: constraint.description,
        source: 'LLM',
        verdict: 'unsure',
        unsureReason: 'LOW_CONFIDENCE',
        taConfiguredDeduction: constraint.deduction,
        proposedDeduction: 0,
        rationale:
          'Mô hình không đủ độ tin cậy để kết luận; yêu cầu TA kiểm tra trực tiếp (FAQ-09).',
        evidence: [],
      };
    }

    const hasMergeRecursion =
      (lower.includes('mergesort') || lower.includes('merge_sort')) && lower.includes('mid');
    if (hasMergeRecursion) {
      const matchLines = findMatchingLines(code, ['mergeSort', 'merge_sort']);
      return {
        constraintId: constraint.id,
        code: constraint.code,
        description: constraint.description,
        source: 'LLM',
        verdict: 'pass',
        unsureReason: null,
        taConfiguredDeduction: constraint.deduction,
        proposedDeduction: 0,
        rationale: 'Phát hiện hàm đệ quy chia đôi mảng và trộn kết quả phù hợp yêu cầu ràng buộc.',
        evidence: matchLines.slice(0, 2),
      };
    }

    const firstLoop = findMatchingLines(code, ['for (', 'while (', 'std::sort']);
    return {
      constraintId: constraint.id,
      code: constraint.code,
      description: constraint.description,
      source: 'LLM',
      verdict: 'violation',
      unsureReason: null,
      taConfiguredDeduction: constraint.deduction,
      proposedDeduction: constraint.deduction,
      rationale: 'Không tìm thấy cấu trúc chia để trị đệ quy tương ứng ràng buộc ngữ nghĩa.',
      evidence: firstLoop.slice(0, 2),
    };
  });

  let bucket: ReviewQueueBucket = 'PASS_SAMPLE_10PCT';
  if (verdicts.some((v) => v.source === 'HARD_RULE' && v.verdict === 'violation')) {
    bucket = 'HARD_RULE_VIOLATION';
  } else if (verdicts.some((v) => v.source === 'LLM' && v.verdict === 'violation')) {
    bucket = 'LLM_VIOLATION';
  } else if (verdicts.some((v) => v.verdict === 'unsure')) {
    bucket = 'UNSURE';
  }

  return { bucket, verdicts };
}

export class MockApiClient implements LeeTkobApiClient {
  public readonly mode = 'mock' as const;

  private readonly users: MockUserRecord[];
  private readonly classes: ClassSummary[];
  private readonly labs: TaLabDetail[];
  private readonly submissions: MockInternalSubmission[];
  private readonly tokens = new Map<string, MockUserRecord>();
  private readonly idempotencyStore = new Map<string, IdempotencyEntry>();
  private readonly judgeStepDelayMs: number;
  private failNextSubmitCount: number;
  private nextIdSeq = 100;

  constructor(options: MockApiClientOptions = {}) {
    const seed = createInitialSeed();
    this.users = seed.users;
    this.classes = seed.classes;
    this.labs = seed.labs;
    this.submissions = seed.submissions;
    this.judgeStepDelayMs = options.judgeStepDelayMs ?? 350;
    this.failNextSubmitCount = options.failNextSubmitCount ?? 0;

    // Pre-issue deterministic mock tokens for active sessions across reloads if desired
    for (const user of this.users) {
      this.tokens.set(`mock-jwt-${user.id}`, user);
    }
  }

  private authenticate(token: string, instance: string): MockUserRecord {
    const user = this.tokens.get(token);
    if (!user) {
      throw problemError(
        401,
        'unauthorized',
        'Unauthorized',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
        instance,
      );
    }
    return user;
  }

  private getLabOrThrow(labId: string, instance: string): TaLabDetail {
    const lab = this.labs.find((item) => item.id === labId);
    if (!lab) {
      throw problemError(
        404,
        'not-found',
        'Not Found',
        `Không tìm thấy bài Lab '${labId}'.`,
        instance,
      );
    }
    return lab;
  }

  private ensureClassAccess(user: MockUserRecord, classId: string, instance: string): void {
    if (user.role === 'ADMIN') return;
    if (!user.classIds.includes(classId)) {
      throw problemError(
        403,
        'forbidden',
        'Forbidden',
        'Bạn không có quyền truy cập vào lớp học hoặc tài nguyên này.',
        instance,
      );
    }
  }

  async login(input: LoginInput): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const user = this.users.find(
      (u) => u.email.toLowerCase() === email && u.password === input.password,
    );
    if (!user) {
      throw problemError(
        401,
        'unauthorized',
        'Unauthorized',
        'Email hoặc mật khẩu không đúng.',
        '/auth/login',
      );
    }
    const accessToken = `mock-jwt-${user.id}`;
    this.tokens.set(accessToken, user);
    return {
      accessToken,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        classIds: [...user.classIds],
      },
    };
  }

  async getCurrentUser(token: string): Promise<SessionUser> {
    const user = this.authenticate(token, '/auth/me');
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      classIds: [...user.classIds],
    };
  }

  async listClasses(token: string): Promise<PaginatedResponse<ClassSummary>> {
    const user = this.authenticate(token, '/classes');
    const visible =
      user.role === 'ADMIN'
        ? this.classes
        : this.classes.filter((cls) => user.classIds.includes(cls.id));
    return {
      items: visible.map((cls) => ({
        ...cls,
        labCount: this.labs.filter((lab) => lab.classId === cls.id).length,
      })),
      nextCursor: null,
    };
  }

  async createClass(token: string, input: CreateClassInput): Promise<ClassSummary> {
    const user = this.authenticate(token, '/classes');
    if (user.role !== 'ADMIN') {
      throw problemError(
        403,
        'forbidden',
        'Forbidden',
        'Chỉ quản trị viên (ADMIN) mới có quyền tạo lớp học mới.',
        '/classes',
      );
    }
    const errors: FieldValidationError[] = [];
    if (!input.code.trim()) errors.push({ field: 'code', message: 'Mã lớp không được để trống.' });
    if (!input.name.trim())
      errors.push({ field: 'name', message: 'Tên môn học không được để trống.' });
    if (!input.term.trim()) errors.push({ field: 'term', message: 'Học kỳ không được để trống.' });
    if (errors.length > 0) {
      throw problemError(
        400,
        'bad-request',
        'Bad Request',
        'Dữ liệu lớp học không hợp lệ.',
        '/classes',
        errors,
      );
    }

    const id = `cls_${++this.nextIdSeq}`;
    const created: ClassSummary = {
      id,
      code: input.code.trim(),
      name: input.name.trim(),
      term: input.term.trim(),
      taIds: [...input.taIds],
      studentCount: 0,
      labCount: 0,
    };
    this.classes.push(created);
    for (const taId of input.taIds) {
      const ta = this.users.find((u) => u.id === taId);
      if (ta && !ta.classIds.includes(id)) {
        ta.classIds.push(id);
      }
    }
    return { ...created };
  }

  async listClassLabs(token: string, classId: string): Promise<PaginatedResponse<LabSummary>> {
    const instance = `/classes/${classId}/labs`;
    const user = this.authenticate(token, instance);
    const cls = this.classes.find((c) => c.id === classId);
    if (!cls) {
      throw problemError(
        404,
        'not-found',
        'Not Found',
        `Không tìm thấy lớp '${classId}'.`,
        instance,
      );
    }
    this.ensureClassAccess(user, classId, instance);

    const items: LabSummary[] = this.labs
      .filter((lab) => lab.classId === classId)
      .map((lab) => {
        const labSubs = this.submissions.filter((s) => s.labId === lab.id);
        const myLatest = labSubs
          .filter((s) => s.studentId === user.id)
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
        return {
          id: lab.id,
          classId: lab.classId,
          classCode: lab.classCode,
          title: lab.title,
          openedAt: lab.openedAt,
          deadline: lab.deadline,
          publishedAt: lab.publishedAt,
          submissionCount: labSubs.length,
          pendingReviewCount: labSubs.filter((s) => s.overallVerdict === 'AC').length,
          latestStudentVerdict:
            user.role === 'STUDENT' ? (myLatest?.overallVerdict ?? null) : undefined,
        };
      });

    return { items, nextCursor: null };
  }

  async createLab(token: string, classId: string, input: CreateLabInput): Promise<TaLabDetail> {
    const instance = `/classes/${classId}/labs`;
    const user = this.authenticate(token, instance);
    if (user.role !== 'TA' && user.role !== 'ADMIN') {
      throw problemError(
        403,
        'forbidden',
        'Forbidden',
        'Chỉ Trợ giảng hoặc Admin mới được tạo bài Lab.',
        instance,
      );
    }
    const cls = this.classes.find((c) => c.id === classId);
    if (!cls) {
      throw problemError(
        404,
        'not-found',
        'Not Found',
        `Không tìm thấy lớp '${classId}'.`,
        instance,
      );
    }
    this.ensureClassAccess(user, classId, instance);

    const errors: FieldValidationError[] = [];
    if (!input.title.trim())
      errors.push({ field: 'title', message: 'Tiêu đề bài Lab là bắt buộc.' });
    if (!input.statement.trim()) {
      errors.push({ field: 'statement', message: 'Nội dung đề bài Markdown không được để trống.' });
    }
    if (new Date(input.deadline).getTime() <= new Date(input.openedAt).getTime()) {
      errors.push({ field: 'deadline', message: 'Hạn nộp phải sau thời điểm mở bài.' });
    }
    if (input.cpuTimeLimitSec < 1 || input.cpuTimeLimitSec > 5) {
      errors.push({
        field: 'cpuTimeLimitSec',
        message: 'Giới hạn thời gian CPU phải trong khoảng 1 đến 5 giây (FAQ-05).',
      });
    }
    if (input.memoryLimitMb < 64 || input.memoryLimitMb > 512) {
      errors.push({
        field: 'memoryLimitMb',
        message: 'Giới hạn bộ nhớ phải trong khoảng 64 đến 512 MB (FAQ-05).',
      });
    }
    if (input.testCases.length === 0) {
      errors.push({ field: 'testCases', message: 'Cần ít nhất 1 test case.' });
    }
    input.constraints.forEach((c, idx) => {
      if (!c.description.trim()) {
        errors.push({
          field: `constraints.${idx}.description`,
          message: `Ràng buộc #${idx + 1} cần mô tả rõ cho sinh viên.`,
        });
      }
      if (c.deduction <= 0 || c.deduction > 10) {
        errors.push({
          field: `constraints.${idx}.deduction`,
          message: `Mức trừ của ràng buộc #${idx + 1} phải trong khoảng (0, 10].`,
        });
      }
    });

    if (errors.length > 0) {
      throw problemError(
        400,
        'bad-request',
        'Bad Request',
        'Thông tin bài Lab chưa hợp lệ. Vui lòng kiểm tra lại các trường bị báo lỗi.',
        instance,
        errors,
      );
    }

    const labId = `lab_${++this.nextIdSeq}`;
    const created: TaLabDetail = {
      id: labId,
      classId: cls.id,
      classCode: cls.code,
      title: input.title.trim(),
      statement: input.statement,
      openedAt: input.openedAt,
      deadline: input.deadline,
      cpuTimeLimitSec: input.cpuTimeLimitSec,
      memoryLimitMb: input.memoryLimitMb,
      maxCodeBytes: MAX_CPP_CODE_BYTES,
      publishedAt: null,
      testCases: input.testCases.map((tc, idx) => ({
        ...tc,
        ordinal: idx + 1,
        id: `tc_${labId}_${idx + 1}`,
      })),
      constraints: input.constraints.map((c, idx) => ({
        id: `con_${labId}_${idx + 1}`,
        code: c.code.trim() || `C${idx + 1}`,
        type: c.type,
        description: c.description.trim(),
        patterns: c.patterns.filter((p) => p.trim().length > 0),
        deduction: c.deduction,
      })),
    };
    this.labs.unshift(created);
    return structuredClone(created);
  }

  async getStudentLab(token: string, labId: string): Promise<StudentLabDetail> {
    const instance = `/labs/${labId}`;
    const user = this.authenticate(token, instance);
    const lab = this.getLabOrThrow(labId, instance);
    this.ensureClassAccess(user, lab.classId, instance);

    // Strictly strip hidden test cases & internal ban patterns (FAQ-02, FAQ-06)
    return {
      id: lab.id,
      classId: lab.classId,
      classCode: lab.classCode,
      title: lab.title,
      statement: lab.statement,
      openedAt: lab.openedAt,
      deadline: lab.deadline,
      cpuTimeLimitSec: lab.cpuTimeLimitSec,
      memoryLimitMb: lab.memoryLimitMb,
      maxCodeBytes: MAX_CPP_CODE_BYTES,
      publishedAt: lab.publishedAt,
      sampleTests: lab.testCases
        .filter((tc) => tc.isSample)
        .map((tc) => ({
          ordinal: tc.ordinal,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
        })),
      constraints: lab.constraints.map((c) => ({
        id: c.id,
        code: c.code,
        description: c.description,
        deduction: c.deduction,
      })),
    };
  }

  async getTaLab(token: string, labId: string): Promise<TaLabDetail> {
    const instance = `/labs/${labId}`;
    const user = this.authenticate(token, instance);
    if (user.role !== 'TA' && user.role !== 'ADMIN') {
      throw problemError(
        403,
        'forbidden',
        'Forbidden',
        'Chỉ Trợ giảng hoặc Admin được xem cấu hình đầy đủ của bài Lab.',
        instance,
      );
    }
    const lab = this.getLabOrThrow(labId, instance);
    this.ensureClassAccess(user, lab.classId, instance);
    return structuredClone(lab);
  }

  async createSubmission(
    token: string,
    labId: string,
    input: CreateSubmissionInput,
    idempotencyKey: string,
  ): Promise<SubmissionAcceptedDto> {
    const instance = `/labs/${labId}/submissions`;
    const user = this.authenticate(token, instance);

    if (user.role !== 'STUDENT') {
      throw problemError(
        403,
        'forbidden',
        'Forbidden',
        'Chỉ sinh viên ghi danh trong lớp mới được nộp mã nguồn.',
        instance,
      );
    }

    const lab = this.getLabOrThrow(labId, instance);
    this.ensureClassAccess(user, lab.classId, instance);

    if (!isValidUuidV4(idempotencyKey)) {
      throw problemError(
        400,
        'bad-request',
        'Bad Request',
        "Header 'Idempotency-Key' bắt buộc phải là UUID v4 hợp lệ.",
        instance,
      );
    }

    if (!input.code || input.code.trim().length === 0) {
      throw problemError(
        400,
        'bad-request',
        'Bad Request',
        'Mã nguồn C++ không được để trống hoặc chỉ chứa khoảng trắng.',
        instance,
      );
    }

    const byteLength = utf8ByteLength(input.code);
    if (byteLength > MAX_CPP_CODE_BYTES) {
      throw problemError(
        400,
        'bad-request',
        'Bad Request',
        `Mã nguồn vượt quá giới hạn 64 KB (hiện tại: ${byteLength} bytes).`,
        instance,
      );
    }

    if (Date.now() > new Date(lab.deadline).getTime()) {
      throw problemError(
        409,
        'deadline-passed',
        'Conflict',
        'Đã quá hạn nộp của bài Lab này.',
        instance,
      );
    }

    // Scoped idempotency key per (studentId, labId, key) — AGENTS.md §4.2
    const compositeKey = `${user.id}:${labId}:${idempotencyKey}`;
    const existing = this.idempotencyStore.get(compositeKey);
    if (existing) {
      if (existing.code !== input.code) {
        throw problemError(
          409,
          'idempotency-conflict',
          'Conflict',
          'Idempotency-Key này đã được dùng với nội dung mã nguồn khác.',
          instance,
        );
      }
      return { ...existing.response };
    }

    if (this.failNextSubmitCount > 0) {
      this.failNextSubmitCount -= 1;
      throw problemError(
        500,
        'internal-server-error',
        'Internal Server Error',
        'Lỗi tạm thời từ máy chủ. Vui lòng thử gửi lại với cùng Idempotency-Key.',
        instance,
      );
    }

    // Clear previous counted flag for this student on this lab (FAQ-04)
    for (const prev of this.submissions) {
      if (prev.labId === labId && prev.studentId === user.id) {
        prev.isCountedForGrade = false;
      }
    }

    const subId = `sub_${++this.nextIdSeq}`;
    const submittedAt = new Date().toISOString();
    const record: MockInternalSubmission = {
      id: subId,
      labId,
      studentId: user.id,
      studentName: user.displayName,
      code: input.code,
      submittedAt,
      idempotencyKey,
      status: 'QUEUED',
      overallVerdict: null,
      compileOutput: null,
      maxTimeMs: null,
      maxMemoryKb: null,
      isCountedForGrade: true,
      internalTestRuns: [],
      checkerStatus: 'PENDING',
      queueBucket: 'PASS_SAMPLE_10PCT',
      constraintVerdicts: [],
    };
    this.submissions.unshift(record);

    const response: SubmissionAcceptedDto = {
      id: subId,
      labId,
      studentId: user.id,
      status: 'QUEUED',
      submittedAt,
      idempotencyKey,
    };
    this.idempotencyStore.set(compositeKey, {
      key: idempotencyKey,
      studentId: user.id,
      labId,
      code: input.code,
      response,
    });

    const finalizeSubmission = () => {
      const hasMain = record.code.includes('main(') || record.code.includes('main (');
      let overall: JudgeVerdict = 'AC';
      let compileOutput: string | null = null;

      if (!hasMain || record.code.includes('SYNTAX_ERROR')) {
        overall = 'CE';
        compileOutput = 'solution.cpp: error: expected valid C++17 main() entry point.';
      } else if (record.code.includes('MOCK_TLE')) {
        overall = 'TLE';
      } else if (record.code.includes('MOCK_WA')) {
        overall = 'WA';
      }

      record.status = 'COMPLETED';
      record.overallVerdict = overall;
      record.compileOutput = compileOutput;
      record.maxTimeMs =
        overall === 'CE' ? null : overall === 'TLE' ? lab.cpuTimeLimitSec * 1000 : 28;
      record.maxMemoryKb = overall === 'CE' ? null : 3960;
      record.internalTestRuns =
        overall === 'CE'
          ? []
          : lab.testCases.map((tc, idx) => ({
              ordinal: tc.ordinal,
              verdict: overall === 'AC' ? 'AC' : idx === lab.testCases.length - 1 ? overall : 'AC',
              timeMs: 6 + idx * 4,
              input: tc.input,
              expectedOutput: tc.expectedOutput,
              actualOutput: overall === 'AC' ? tc.expectedOutput : 'MISMATCH',
            }));

      if (overall === 'AC') {
        const checked = evaluateMockConstraints(record.code, lab);
        record.checkerStatus = 'COMPLETED';
        record.queueBucket = checked.bucket;
        record.constraintVerdicts = checked.verdicts;
      } else {
        record.checkerStatus = 'COMPLETED';
        record.constraintVerdicts = [];
      }
    };

    if (this.judgeStepDelayMs <= 0) {
      finalizeSubmission();
    } else {
      setTimeout(() => {
        record.status = 'JUDGING';
      }, this.judgeStepDelayMs);
      setTimeout(() => {
        finalizeSubmission();
      }, this.judgeStepDelayMs * 2);
    }

    return response;
  }

  async listMySubmissions(
    token: string,
    labId: string,
  ): Promise<PaginatedResponse<StudentSubmissionSummary>> {
    const instance = `/labs/${labId}/submissions/me`;
    const user = this.authenticate(token, instance);
    const lab = this.getLabOrThrow(labId, instance);
    this.ensureClassAccess(user, lab.classId, instance);

    const mine = this.submissions
      .filter((s) => s.labId === labId && s.studentId === user.id)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .map((s) => ({
        id: s.id,
        labId: s.labId,
        submittedAt: s.submittedAt,
        status: s.status,
        overallVerdict: s.overallVerdict,
        passedTests: s.internalTestRuns.filter((t) => t.verdict === 'AC').length,
        totalTests: lab.testCases.length,
        maxTimeMs: s.maxTimeMs,
        maxMemoryKb: s.maxMemoryKb,
        isCountedForGrade: s.isCountedForGrade,
      }));

    return { items: mine, nextCursor: null };
  }

  async getStudentSubmission(token: string, submissionId: string): Promise<StudentSubmissionView> {
    const instance = `/submissions/${submissionId}`;
    const user = this.authenticate(token, instance);
    const sub = this.submissions.find((s) => s.id === submissionId);
    if (!sub) {
      throw problemError(
        404,
        'not-found',
        'Not Found',
        `Không tìm thấy bài nộp '${submissionId}'.`,
        instance,
      );
    }
    const lab = this.getLabOrThrow(sub.labId, instance);
    this.ensureClassAccess(user, lab.classId, instance);
    if (user.role === 'STUDENT' && sub.studentId !== user.id) {
      throw problemError(
        403,
        'forbidden',
        'Forbidden',
        'Bạn không thể xem bài nộp của sinh viên khác.',
        instance,
      );
    }

    // STRICT FAQ-02 & FAQ-08 PROJECTION:
    // Strip test inputs/outputs AND strip all constraintVerdicts/evidence/unsureReason before Publish.
    return {
      id: sub.id,
      labId: sub.labId,
      studentId: sub.studentId,
      submittedAt: sub.submittedAt,
      status: sub.status,
      overallVerdict: sub.overallVerdict,
      passedTests: sub.internalTestRuns.filter((t) => t.verdict === 'AC').length,
      totalTests: lab.testCases.length,
      maxTimeMs: sub.maxTimeMs,
      maxMemoryKb: sub.maxMemoryKb,
      isCountedForGrade: sub.isCountedForGrade,
      code: sub.code,
      compileOutput: sub.compileOutput,
      testVerdicts: sub.internalTestRuns.map((t) => ({
        ordinal: t.ordinal,
        verdict: t.verdict,
        timeMs: t.timeMs,
      })),
      publishedGrade: null,
    };
  }

  async listReviewQueue(
    token: string,
    labId: string,
    query: ReviewQueueQuery,
  ): Promise<PaginatedResponse<ReviewQueueItem>> {
    const instance = `/labs/${labId}/review-queue`;
    const user = this.authenticate(token, instance);
    if (user.role !== 'TA' && user.role !== 'ADMIN') {
      throw problemError(
        403,
        'forbidden',
        'Forbidden',
        'Chỉ Trợ giảng của lớp mới có quyền truy cập Hàng chờ Soát Ràng buộc (FAQ-08).',
        instance,
      );
    }
    const lab = this.getLabOrThrow(labId, instance);
    this.ensureClassAccess(user, lab.classId, instance);

    const priorityOrder: Record<ReviewQueueBucket, number> = {
      HARD_RULE_VIOLATION: 1,
      LLM_VIOLATION: 2,
      UNSURE: 3,
      PASS_SAMPLE_10PCT: 4,
    };

    const labelByBucket: Record<ReviewQueueBucket, string> = {
      HARD_RULE_VIOLATION: 'Vi phạm quy tắc cứng',
      LLM_VIOLATION: 'LLM đề xuất vi phạm',
      UNSURE: 'Không chắc chắn (Unsure)',
      PASS_SAMPLE_10PCT: 'Đạt (Mẫu đối chứng 10%)',
    };

    const filtered = this.submissions
      .filter((s) => s.labId === labId && s.overallVerdict === 'AC')
      .filter((s) => (query.scope === 'counted' ? s.isCountedForGrade : true))
      .filter((s) =>
        !query.bucket || query.bucket === 'ALL' ? true : s.queueBucket === query.bucket,
      )
      .sort((a, b) => {
        const diff = priorityOrder[a.queueBucket] - priorityOrder[b.queueBucket];
        if (diff !== 0) return diff;
        return b.submittedAt.localeCompare(a.submittedAt);
      })
      .map<ReviewQueueItem>((s) => ({
        submissionId: s.id,
        labId: s.labId,
        studentId: s.studentId,
        studentName: s.studentName,
        submittedAt: s.submittedAt,
        isCountedForGrade: s.isCountedForGrade,
        overallVerdict: s.overallVerdict ?? 'AC',
        checkerStatus: s.checkerStatus,
        queueBucket: s.queueBucket,
        summaryLabel: labelByBucket[s.queueBucket],
        violationCount: s.constraintVerdicts.filter((v) => v.verdict === 'violation').length,
        unsureCount: s.constraintVerdicts.filter((v) => v.verdict === 'unsure').length,
        maxTimeMs: s.maxTimeMs,
        maxMemoryKb: s.maxMemoryKb,
      }));

    return { items: filtered, nextCursor: null };
  }

  async getTaSubmissionReview(
    token: string,
    submissionId: string,
  ): Promise<TaSubmissionReviewView> {
    const instance = `/submissions/${submissionId}`;
    const user = this.authenticate(token, instance);
    if (user.role !== 'TA' && user.role !== 'ADMIN') {
      throw problemError(
        403,
        'forbidden',
        'Forbidden',
        'Sinh viên không có quyền xem kết quả soát ràng buộc và bằng chứng trước khi công bố (FAQ-08).',
        instance,
      );
    }
    const sub = this.submissions.find((s) => s.id === submissionId);
    if (!sub) {
      throw problemError(
        404,
        'not-found',
        'Not Found',
        `Không tìm thấy bài nộp '${submissionId}'.`,
        instance,
      );
    }
    const lab = this.getLabOrThrow(sub.labId, instance);
    this.ensureClassAccess(user, lab.classId, instance);

    return {
      submissionId: sub.id,
      labId: sub.labId,
      labTitle: lab.title,
      publishedAt: lab.publishedAt,
      studentId: sub.studentId,
      studentName: sub.studentName,
      submittedAt: sub.submittedAt,
      isCountedForGrade: sub.isCountedForGrade,
      overallVerdict: sub.overallVerdict ?? 'AC',
      passedTests: sub.internalTestRuns.filter((t) => t.verdict === 'AC').length,
      totalTests: lab.testCases.length,
      maxTimeMs: sub.maxTimeMs,
      maxMemoryKb: sub.maxMemoryKb,
      code: sub.code,
      testVerdicts: sub.internalTestRuns.map((t) => ({
        ordinal: t.ordinal,
        verdict: t.verdict,
        timeMs: t.timeMs,
      })),
      checkerStatus: sub.checkerStatus,
      queueBucket: sub.queueBucket,
      constraintVerdicts: structuredClone(sub.constraintVerdicts),
    };
  }
}
