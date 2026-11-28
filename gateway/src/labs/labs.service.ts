import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { problemException } from '../common/http-problems';
import { AuthStore } from '../auth/auth.store';
import { PostgresPersistence } from '../persistence/postgres.store';
import { SubmissionStore } from '../submissions/submissions.store';
import { LabsStore } from './labs.store';
import { Lab, LabConstraint, LabTestCase, UserRole } from '../submissions/submissions.types';
import { CreateLabInput } from './dto/create-lab.dto';

const REVIEW_NOTICE =
  'Submitted code is checked by syntax hard rules and an anonymized LLM constraint checker ' +
  '(comments, names, and student IDs are removed). A TA reviews all deductions before grades are published.';

export interface LabStudentView {
  id: string;
  classId: string;
  title: string;
  statement: string;
  openedAt?: string;
  deadline: string;
  cpuTimeLimitSec: number;
  memoryLimitMb: number;
  maxPayloadSize: number;
  isActive: boolean;
  publishedAt: string | null;
  isPublished: boolean;
  createdAt?: string;
  constraints: LabConstraint[];
  testCases: LabTestCase[];
  reviewNotice: string;
}

@Injectable()
export class LabsService {
  constructor(
    private readonly authStore: AuthStore,
    private readonly labsStore: LabsStore,
    @Optional() private readonly submissionStore?: SubmissionStore,
    @Optional() private readonly postgres?: PostgresPersistence,
  ) {}

  async createLab(taUserId: string, input: CreateLabInput, idempotencyKey?: string): Promise<Lab> {
    const managedClasses = await this.authStore.taClassesAsync(taUserId);
    if (!managedClasses.includes(input.classId)) {
      throw problemException(
        HttpStatus.FORBIDDEN,
        'You are not authorized to access labs in this class.',
      );
    }

    const nowMs = Date.now();
    const payloadHash = idempotencyKey
      ? createHash('sha256')
          .update(
            JSON.stringify({
              scope: 'CREATE_LAB',
              classId: input.classId,
              title: input.title,
              statement: input.statement,
              openedAt: input.openedAt ?? null,
              deadline: input.deadline,
              cpuTimeLimitSec: input.cpuTimeLimitSec ?? 1,
              memoryLimitMb: input.memoryLimitMb ?? 256,
              testCases: input.testCases,
              constraints: input.constraints,
            }),
          )
          .digest('hex')
      : undefined;

    if (idempotencyKey && !this.postgres?.isEnabled() && this.submissionStore) {
      const cached = this.submissionStore.getIdempotencyRecord<Lab>(
        taUserId,
        idempotencyKey,
        nowMs,
      );
      if (cached) {
        if (cached.payloadHash !== payloadHash) {
          throw problemException(
            HttpStatus.CONFLICT,
            'The provided Idempotency-Key has already been used with different request parameters.',
            'idempotency-conflict',
          );
        }
        return cached.responseBody;
      }
    }

    const lab: Lab = {
      id: `lab_${randomUUID()}`,
      classId: input.classId,
      title: input.title,
      statement: input.statement,
      openedAt: input.openedAt,
      deadline: input.deadline,
      cpuTimeLimitSec: input.cpuTimeLimitSec ?? 1,
      memoryLimitMb: input.memoryLimitMb ?? 256,
      maxPayloadSize: 65536,
      isActive: true,
      testCases: input.testCases,
      constraints: input.constraints,
      publishedAt: null,
      isPublished: false,
      createdBy: taUserId,
      createdAt: new Date(nowMs).toISOString(),
    };

    const saved = await this.labsStore.saveLabAsync(
      lab,
      idempotencyKey && payloadHash
        ? { actorId: taUserId, idempotencyKey, payloadHash, nowMs }
        : undefined,
    );

    if (idempotencyKey && payloadHash && !this.postgres?.isEnabled() && this.submissionStore) {
      this.submissionStore.saveIdempotencyRecord<Lab>({
        key: idempotencyKey,
        studentId: taUserId,
        labId: saved.id,
        payloadHash,
        statusCode: 201,
        responseHeaders: {
          Location: `/labs/${saved.id}`,
          'Content-Type': 'application/json',
        },
        responseBody: saved,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return saved;
  }

  async listLabs(userId: string, role: UserRole): Promise<Array<Lab | LabStudentView>> {
    const allowedClasses =
      role === 'ADMIN'
        ? null
        : role === 'TA'
          ? await this.authStore.taClassesAsync(userId)
          : await this.authStore.activeClassesAsync(userId);

    const labs = await this.labsStore.getAllLabsAsync(allowedClasses, role === 'STUDENT');
    return labs.map((lab) => (role === 'STUDENT' ? this.toStudentView(lab) : lab));
  }

  async getLabForUser(
    labId: string,
    userId: string,
    role: UserRole,
  ): Promise<Lab | LabStudentView> {
    const lab =
      role === 'STUDENT'
        ? await this.labsStore.getStudentLabAsync(labId)
        : await this.labsStore.getLabAsync(labId);
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
      return this.toStudentView(lab);
    }

    return lab;
  }

  toStudentView(lab: Lab): LabStudentView {
    return {
      id: lab.id,
      classId: lab.classId,
      title: lab.title,
      statement: lab.statement ?? '',
      openedAt: lab.openedAt,
      deadline: lab.deadline,
      cpuTimeLimitSec: lab.cpuTimeLimitSec ?? 1,
      memoryLimitMb: lab.memoryLimitMb ?? 256,
      maxPayloadSize: lab.maxPayloadSize,
      isActive: lab.isActive,
      publishedAt: lab.publishedAt ?? null,
      isPublished: lab.isPublished ?? lab.publishedAt != null,
      createdAt: lab.createdAt,
      constraints: lab.constraints ?? [],
      testCases: (lab.testCases ?? []).filter((tc) => !tc.isHidden),
      reviewNotice: REVIEW_NOTICE,
    };
  }
}
