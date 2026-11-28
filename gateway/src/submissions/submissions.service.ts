import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthStore } from '../auth/auth.store';
import { problemException } from '../common/http-problems';
import {
  encodeKeysetCursor,
  isAfterReviewQueueKeyset,
  parseKeysetPagination,
} from '../common/pagination';
import { LabsStore } from '../labs/labs.store';
import {
  ConstraintFindingRecord,
  EvidenceLine,
  JudgeVerdict,
  Lab,
  Submission,
  SubmissionResponse,
  SubmissionStatus,
  SubmissionTestResult,
  UserRole,
} from './submissions.types';
import { SubmissionStore } from './submissions.store';

export interface SubmissionSummaryItem {
  id: string;
  labId: string;
  studentId: string;
  studentName?: string;
  status: SubmissionStatus;
  overallVerdict: JudgeVerdict | null;
  passedTests: number;
  totalTests: number;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  isCounting: boolean;
  submittedAt: string;
}

export interface StudentDeductionItem {
  constraintCode: string;
  constraintText: string;
  deduction: number;
  evidence: EvidenceLine[];
  reason: string | null;
}

/**
 * Student-safe submission result view enforcing PA#3 Syllabus Rule, FAQ-02, FAQ-04, FAQ-08, FAQ-11.
 * Before Publish: only status, overallVerdict, and testVerdicts[] (no test I/O, no checker data).
 * After Publish: adds finalScore and TA-approved deductions[] only.
 */
export interface StudentSubmissionResultView {
  id: string;
  labId: string;
  studentId: string;
  status: SubmissionStatus;
  overallVerdict: JudgeVerdict | null;
  passedTests: number;
  totalTests: number;
  maxTimeMs: number | null;
  maxMemoryKb: number | null;
  isCounting: boolean;
  isPublished: boolean;
  publishedAt?: string;
  submittedAt: string;
  testVerdicts: SubmissionTestResult[];
  finalScore?: number;
  deductions?: StudentDeductionItem[];
}

export interface TaReviewFindingView {
  findingId: string;
  submissionId: string;
  studentId: string;
  studentName?: string;
  isCounting: boolean;
  submittedAt: string;
  constraintId: string;
  constraintCode: string;
  constraintText: string;
  configuredDeduction: number;
  proposedDeduction: number;
  source: ConstraintFindingRecord['source'];
  verdict: ConstraintFindingRecord['verdict'];
  unsureReason: ConstraintFindingRecord['unsureReason'];
  evidence: EvidenceLine[];
  reason: string | null;
  isSampledPass: boolean;
  reviewStatus: ConstraintFindingRecord['reviewStatus'];
  taDecision: ConstraintFindingRecord['taDecision'];
  taDeduction: number | null;
  taEvidence: EvidenceLine[] | null;
  taReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface TaReviewQueueResponse {
  labId: string;
  labTitle: string;
  scope: 'counted' | 'all';
  isPublished: boolean;
  publishedAt: string | null;
  pendingReviewCount: number;
  items: TaReviewFindingView[];
  nextCursor: string | null;
}

export interface TaSubmissionReviewResponse {
  labTitle: string;
  isPublished: boolean;
  publishedAt: string | null;
  studentName: string;
  submission: Submission;
  testVerdicts: SubmissionTestResult[];
  findings: TaReviewFindingView[];
}

export interface TaReviewDecisionPayload {
  decision: 'PASS' | 'VIOLATION';
  deduction?: number;
  evidence?: EvidenceLine[];
  reason?: string | null;
}

export interface PublishLabResponse {
  labId: string;
  isPublished: true;
  publishedAt: string;
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly store: SubmissionStore,
    private readonly labsStore: LabsStore,
    private readonly authStore: AuthStore,
  ) {}

  async createSubmission(
    labId: string,
    studentId: string,
    code: string,
    idempotencyKey: string,
    receivedAt: number = Date.now(),
  ): Promise<SubmissionResponse> {
    const payloadHash = createHash('sha256').update(JSON.stringify({ labId, code })).digest('hex');
    return this.store.createSubmissionAtomicAsync({
      labId,
      studentId,
      code,
      idempotencyKey,
      payloadHash,
      receivedAt,
    });
  }

  async getSubmission(id: string): Promise<Submission | undefined> {
    return this.store.getSubmissionAsync(id);
  }

  async listSubmissionsForUser(
    labId: string,
    userId: string,
    role: UserRole,
    rawCursor?: string,
    rawLimit?: string,
  ): Promise<{
    labId: string;
    isPublished: boolean;
    submissions: SubmissionSummaryItem[];
    nextCursor: string | null;
  }> {
    const scope = `lab-submissions:${labId}:${role === 'STUDENT' ? userId : 'all'}`;
    const { cursor, limit } = parseKeysetPagination(rawCursor, rawLimit, scope, {
      defaultLimit: 50,
    });
    const lab = await this.requireLabAccess(labId, userId, role);
    const rows = await this.store.listSubmissionsPageAsync(
      labId,
      role === 'STUDENT' ? userId : null,
      cursor,
      limit,
    );
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const studentNameCache = new Map<string, string>();
    const submissions = await Promise.all(
      pageRows.map(async (s) => ({
        id: s.id,
        labId: s.labId,
        studentId: s.studentId,
        studentName: await this.resolveStudentDisplayName(s.studentId, studentNameCache),
        status: s.status,
        overallVerdict: s.overallVerdict ?? null,
        passedTests: s.passedTests ?? 0,
        totalTests: s.totalTests ?? 0,
        maxTimeMs: s.maxTimeMs ?? null,
        maxMemoryKb: s.maxMemoryKb ?? null,
        isCounting: Boolean(s.isCounting),
        submittedAt: s.submittedAt,
      })),
    );

    const last = pageRows[pageRows.length - 1];
    return {
      labId: lab.id,
      isPublished: Boolean(lab.isPublished),
      submissions,
      nextCursor:
        hasMore && last ? encodeKeysetCursor({ s: scope, t: last.submittedAt, id: last.id }) : null,
    };
  }

  async getSubmissionResultForUser(
    labId: string,
    submissionId: string,
    userId: string,
    role: UserRole,
  ): Promise<StudentSubmissionResultView> {
    const lab = await this.requireLabAccess(labId, userId, role);
    const submission = await this.store.getSubmissionAsync(submissionId);
    if (!submission || submission.labId !== labId) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `Submission '${submissionId}' was not found in lab '${labId}'.`,
      );
    }

    if (role === 'STUDENT' && submission.studentId !== userId) {
      throw problemException(
        HttpStatus.FORBIDDEN,
        'Students may only view their own submission results.',
      );
    }

    const testVerdicts = await this.store.getSubmissionTestResultsAsync(submission.id);
    const isPublished = Boolean(lab.isPublished);

    // Base view: strictly Syllabus Rule & FAQ-02/FAQ-08 compliant (no test I/O, no checker data).
    const baseView: StudentSubmissionResultView = {
      id: submission.id,
      labId: submission.labId,
      studentId: submission.studentId,
      status: submission.status,
      overallVerdict: submission.overallVerdict ?? null,
      passedTests: submission.passedTests ?? 0,
      totalTests: submission.totalTests ?? 0,
      maxTimeMs: submission.maxTimeMs ?? null,
      maxMemoryKb: submission.maxMemoryKb ?? null,
      isCounting: Boolean(submission.isCounting),
      isPublished,
      submittedAt: submission.submittedAt,
      testVerdicts: testVerdicts.map((t) => ({
        ordinal: t.ordinal,
        verdict: t.verdict,
        timeMs: t.timeMs ?? null,
        memoryKb: t.memoryKb ?? null,
      })),
    };

    if (!isPublished) {
      return baseView;
    }

    // After Publish (FAQ-04, FAQ-08, FAQ-11): compute finalScore & include ONLY TA-approved violations.
    const constraintByCode = new Map((lab.constraints ?? []).map((c) => [c.code ?? c.id, c]));
    const findings = await this.store.getSubmissionFindingsAsync(submission.id);
    const approvedViolations = findings.filter(
      (f) => f.reviewStatus === 'APPROVED_VIOLATION' && f.taDecision === 'VIOLATION',
    );

    const seenConstraintCodes = new Set<string>();
    const deductions: StudentDeductionItem[] = [];
    let totalDeduction = 0;

    for (const f of approvedViolations) {
      if (seenConstraintCodes.has(f.constraintCode)) {
        continue;
      }
      seenConstraintCodes.add(f.constraintCode);
      const constraintDef = constraintByCode.get(f.constraintCode);
      const deductionAmount = f.taDeduction ?? constraintDef?.deduction ?? 0;
      totalDeduction += deductionAmount;
      deductions.push({
        constraintCode: f.constraintCode,
        constraintText: constraintDef?.text ?? f.constraintCode,
        deduction: deductionAmount,
        evidence: (f.taEvidence && f.taEvidence.length > 0 ? f.taEvidence : f.evidence).map(
          (e) => ({ line: e.line, text: e.text }),
        ),
        reason: f.taReason ?? f.reason ?? null,
      });
    }

    const finalScore =
      submission.manualScore !== null && submission.manualScore !== undefined
        ? submission.manualScore
        : submission.overallVerdict === 'AC'
          ? Math.max(0, Math.round((10 - totalDeduction) * 100) / 100)
          : 0;

    return {
      ...baseView,
      publishedAt: lab.publishedAt ?? undefined,
      finalScore,
      deductions,
    };
  }

  async getReviewQueueForTa(
    labId: string,
    userId: string,
    role: UserRole,
    scope: 'counted' | 'all' = 'counted',
    rawCursor?: string,
    rawLimit?: string,
  ): Promise<TaReviewQueueResponse> {
    const cursorScope = `review-queue:${labId}:${scope}`;
    const { cursor, limit } = parseKeysetPagination(rawCursor, rawLimit, cursorScope, {
      defaultLimit: 50,
      requireSecondaryKey: true,
    });
    const lab = await this.requireTaOrAdminLabAccess(labId, userId, role);
    const entries = await this.store.listLabReviewQueueAsync(labId, scope);

    const allItems: TaReviewFindingView[] = [];
    const studentNameCache = new Map<string, string>();
    for (const entry of entries) {
      const studentName = await this.resolveStudentDisplayName(
        entry.submission.studentId,
        studentNameCache,
      );
      const relevantFindings =
        scope === 'counted'
          ? entry.findings.filter(
              (f) =>
                f.verdict === 'violation' ||
                f.verdict === 'unsure' ||
                f.isSampledPass ||
                f.reviewStatus !== 'NOT_QUEUED',
            )
          : entry.findings;

      for (const finding of relevantFindings) {
        allItems.push(this.toTaReviewFindingView(lab, entry.submission, finding, studentName));
      }
    }

    const pendingReviewCount = allItems.filter(
      (item) => item.reviewStatus === 'PENDING_REVIEW',
    ).length;

    const afterCursor = cursor
      ? allItems.filter((item) =>
          isAfterReviewQueueKeyset(
            item.submittedAt,
            item.submissionId,
            item.constraintCode,
            cursor,
          ),
        )
      : allItems;
    const hasMore = afterCursor.length > limit;
    const items = hasMore ? afterCursor.slice(0, limit) : afterCursor;
    const last = items[items.length - 1];

    return {
      labId: lab.id,
      labTitle: lab.title,
      scope,
      isPublished: Boolean(lab.isPublished),
      publishedAt: lab.publishedAt ?? null,
      pendingReviewCount,
      items,
      nextCursor:
        hasMore && last
          ? encodeKeysetCursor({
              s: cursorScope,
              t: last.submittedAt,
              id: last.submissionId,
              k: last.constraintCode,
            })
          : null,
    };
  }

  async getSubmissionReviewForTa(
    labId: string,
    submissionId: string,
    userId: string,
    role: UserRole,
  ): Promise<TaSubmissionReviewResponse> {
    const lab = await this.requireTaOrAdminLabAccess(labId, userId, role);
    const submission = await this.store.getSubmissionAsync(submissionId);
    if (!submission || submission.labId !== labId) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `Submission '${submissionId}' was not found in lab '${labId}'.`,
      );
    }

    const [testVerdicts, findings, studentName] = await Promise.all([
      this.store.getSubmissionTestResultsAsync(submission.id),
      this.store.getSubmissionFindingsAsync(submission.id),
      this.resolveStudentDisplayName(submission.studentId),
    ]);

    return {
      labTitle: lab.title,
      isPublished: Boolean(lab.isPublished),
      publishedAt: lab.publishedAt ?? null,
      studentName,
      submission,
      testVerdicts,
      findings: findings.map((f) => this.toTaReviewFindingView(lab, submission, f, studentName)),
    };
  }

  async reviewFindingForTa(
    labId: string,
    submissionId: string,
    findingId: string,
    actorId: string,
    role: UserRole,
    payload: TaReviewDecisionPayload,
  ): Promise<ConstraintFindingRecord> {
    const lab = await this.requireTaOrAdminLabAccess(labId, actorId, role);
    if (lab.isPublished && (!payload.reason || payload.reason.trim().length === 0)) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Modifying a review decision after Publish requires a non-empty reason (FAQ-12).',
        undefined,
        [
          {
            field: 'reason',
            message:
              'Modifying a review decision after Publish requires a non-empty reason (FAQ-12).',
          },
        ],
      );
    }
    const submission = await this.store.getSubmissionAsync(submissionId);
    if (!submission || submission.labId !== labId) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `Submission '${submissionId}' was not found in lab '${labId}'.`,
      );
    }

    const existingFindings = await this.store.getSubmissionFindingsAsync(submission.id);
    const targetFinding = existingFindings.find((f) => f.id === findingId);
    if (!targetFinding) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `Constraint finding '${findingId}' was not found.`,
      );
    }

    const constraintDef = (lab.constraints ?? []).find(
      (c) => (c.code ?? c.id) === targetFinding.constraintCode,
    );
    const deduction =
      payload.decision === 'VIOLATION' ? (payload.deduction ?? constraintDef?.deduction ?? 0) : 0;

    return this.store.reviewConstraintFindingAsync({
      findingId,
      labId,
      submissionId,
      actorId,
      decision: payload.decision,
      deduction,
      evidence: payload.evidence,
      reason: payload.reason ?? null,
    });
  }

  async publishLabForTa(
    labId: string,
    actorId: string,
    role: UserRole,
    nowMs: number = Date.now(),
  ): Promise<PublishLabResponse> {
    await this.requireTaOrAdminLabAccess(labId, actorId, role);
    const publishedAt = await this.store.publishLabAtomicAsync(labId, actorId, nowMs);
    return {
      labId,
      isPublished: true,
      publishedAt,
    };
  }

  private async requireLabAccess(labId: string, userId: string, role: UserRole): Promise<Lab> {
    const lab = await this.labsStore.getLabAsync(labId);
    if (!lab) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `The requested lab with ID '${labId}' does not exist.`,
      );
    }

    if (role === 'TA') {
      const managedClasses = await this.authStore.taClassesAsync(userId);
      if (!managedClasses.includes(lab.classId)) {
        throw problemException(
          HttpStatus.FORBIDDEN,
          'You are not authorized to access labs in this class.',
        );
      }
      return lab;
    }

    if (role === 'STUDENT') {
      const enrolledClasses = await this.authStore.activeClassesAsync(userId);
      if (!enrolledClasses.includes(lab.classId)) {
        throw problemException(
          HttpStatus.FORBIDDEN,
          'You are not enrolled in the class owning this lab.',
        );
      }
      return lab;
    }

    return lab;
  }

  private async requireTaOrAdminLabAccess(
    labId: string,
    userId: string,
    role: UserRole,
  ): Promise<Lab> {
    if (role === 'STUDENT') {
      throw problemException(
        HttpStatus.FORBIDDEN,
        'Only Teaching Assistants or Administrators may access lab review endpoints.',
      );
    }
    return this.requireLabAccess(labId, userId, role);
  }

  private async resolveStudentDisplayName(
    studentId: string,
    cache?: Map<string, string>,
  ): Promise<string> {
    const cached = cache?.get(studentId);
    if (cached) {
      return cached;
    }
    const user = await this.authStore.findUserByIdAsync(studentId);
    const displayName = user?.displayName ?? user?.username ?? studentId;
    cache?.set(studentId, displayName);
    return displayName;
  }

  private toTaReviewFindingView(
    lab: Lab,
    submission: Submission,
    finding: ConstraintFindingRecord,
    studentName?: string,
  ): TaReviewFindingView {
    const constraintDef = (lab.constraints ?? []).find(
      (c) => (c.code ?? c.id) === finding.constraintCode,
    );
    const configuredDeduction = constraintDef?.deduction ?? 0;
    const proposedDeduction = finding.verdict === 'violation' ? configuredDeduction : 0;

    return {
      findingId: finding.id,
      submissionId: finding.submissionId,
      studentId: submission.studentId,
      studentName: studentName ?? submission.studentId,
      isCounting: Boolean(submission.isCounting),
      submittedAt: submission.submittedAt,
      constraintId: finding.constraintId,
      constraintCode: finding.constraintCode,
      constraintText: constraintDef?.text ?? finding.constraintCode,
      configuredDeduction,
      proposedDeduction,
      source: finding.source,
      verdict: finding.verdict,
      unsureReason: finding.unsureReason,
      evidence: finding.evidence.map((e) => ({ line: e.line, text: e.text })),
      reason: finding.reason,
      isSampledPass: finding.isSampledPass,
      reviewStatus: finding.reviewStatus,
      taDecision: finding.taDecision,
      taDeduction: finding.taDeduction,
      taEvidence: finding.taEvidence
        ? finding.taEvidence.map((e) => ({ line: e.line, text: e.text }))
        : null,
      taReason: finding.taReason,
      reviewedBy: finding.reviewedBy,
      reviewedAt: finding.reviewedAt,
    };
  }
}
