import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuthStore } from '../auth/auth.store';
import { problemException } from '../common/http-problems';
import { encodeKeysetCursor, parseKeysetPagination } from '../common/pagination';
import { CreateLabInput } from '../labs/dto/create-lab.dto';
import { LabsService, LabStudentView } from '../labs/labs.service';
import { LabsStore } from '../labs/labs.store';
import { PostgresPersistence } from '../persistence/postgres.store';
import { SubmissionStore } from '../submissions/submissions.store';
import { JudgeVerdict, Lab, UserRole } from '../submissions/submissions.types';
import { ClassesStore, ClassSummaryRecord } from './classes.store';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateClassPayload {
  code: string;
  name: string;
  term: string;
  taIds: string[];
}

const DEFAULT_LAB_CREATED_AT = '2026-11-01T00:00:00.000Z';

@Injectable()
export class ClassesService {
  constructor(
    private readonly classesStore: ClassesStore,
    private readonly authStore: AuthStore,
    private readonly labsService: LabsService,
    private readonly submissionStore: SubmissionStore,
    private readonly labsStore: LabsStore,
    @Optional() private readonly postgres?: PostgresPersistence,
  ) {}

  async listClasses(
    userId: string,
    role: UserRole,
    rawCursor?: string,
    rawLimit?: string,
  ): Promise<CursorPage<ClassSummaryRecord>> {
    const scope = 'classes';
    const { cursor, limit } = parseKeysetPagination(rawCursor, rawLimit, scope, {
      defaultLimit: 20,
    });
    const rows = await this.classesStore.listClassesPageForUserAsync(userId, role, cursor, limit);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    let enriched = pageRows;
    if (!this.postgres?.isEnabled() && pageRows.length > 0) {
      const visibleLabs = await this.labsService.listLabs(userId, role);
      const labCountByClass = new Map<string, number>();
      for (const lab of visibleLabs) {
        labCountByClass.set(lab.classId, (labCountByClass.get(lab.classId) ?? 0) + 1);
      }
      enriched = pageRows.map((cls) => ({
        ...cls,
        labCount: labCountByClass.get(cls.id) ?? cls.labCount,
      }));
    }

    const last = enriched[enriched.length - 1];
    return {
      items: enriched,
      nextCursor:
        hasMore && last ? encodeKeysetCursor({ s: scope, t: last.createdAt, id: last.id }) : null,
    };
  }

  async createClass(
    actorId: string,
    actorRole: UserRole,
    input: CreateClassPayload,
    idempotencyKey?: string,
  ): Promise<ClassSummaryRecord> {
    if (actorRole !== 'ADMIN') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only ADMIN users may create classes (FAQ-01).');
    }

    const nowMs = Date.now();
    const payloadHash = idempotencyKey
      ? createHash('sha256')
          .update(
            JSON.stringify({
              scope: 'POST /classes',
              code: input.code,
              name: input.name,
              term: input.term,
              taIds: input.taIds,
            }),
          )
          .digest('hex')
      : undefined;

    if (idempotencyKey && !this.postgres?.isEnabled()) {
      const cached = this.submissionStore.getIdempotencyRecord<ClassSummaryRecord>(
        actorId,
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
        return { ...cached.responseBody, taIds: [...cached.responseBody.taIds] };
      }
    }

    const record: ClassSummaryRecord = {
      id: `class_${randomUUID()}`,
      code: input.code,
      name: input.name,
      term: input.term,
      inviteCode: null,
      createdBy: actorId,
      taIds: input.taIds,
      studentCount: 0,
      labCount: 0,
      createdAt: new Date(nowMs).toISOString(),
    };

    const created = await this.classesStore.createClassAsync(
      record,
      idempotencyKey && payloadHash ? { actorId, idempotencyKey, payloadHash, nowMs } : undefined,
    );

    if (!this.postgres?.isEnabled()) {
      this.authStore.assignTasToClass(created.id, created.taIds);
    }

    if (idempotencyKey && payloadHash && !this.postgres?.isEnabled()) {
      this.submissionStore.saveIdempotencyRecord<ClassSummaryRecord>({
        key: idempotencyKey,
        studentId: actorId,
        labId: null,
        payloadHash,
        statusCode: 201,
        responseHeaders: {
          Location: `/classes/${created.id}`,
          'Content-Type': 'application/json',
        },
        responseBody: created,
        createdAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return created;
  }

  async listClassLabs(
    classId: string,
    userId: string,
    role: UserRole,
    rawCursor?: string,
    rawLimit?: string,
  ): Promise<
    CursorPage<
      (Lab | LabStudentView) & {
        classCode?: string;
        submissionCount?: number;
        pendingReviewCount?: number;
        latestStudentVerdict?: JudgeVerdict | null;
      }
    >
  > {
    const scope = `class-labs:${classId}`;
    const { cursor, limit } = parseKeysetPagination(rawCursor, rawLimit, scope, {
      defaultLimit: 20,
    });
    const cls = await this.assertClassReadable(classId, userId, role);

    const rawRows = await this.labsStore.listClassLabsPageAsync(
      classId,
      role === 'STUDENT',
      cursor,
      limit,
    );
    const hasMore = rawRows.length > limit;
    const pageRaw = hasMore ? rawRows.slice(0, limit) : rawRows;
    const lastRaw = pageRaw[pageRaw.length - 1];
    const nextCursor =
      hasMore && lastRaw
        ? encodeKeysetCursor({
            s: scope,
            t: lastRaw.createdAt ?? DEFAULT_LAB_CREATED_AT,
            id: lastRaw.id,
          })
        : null;

    if (role === 'STUDENT') {
      const studentItems = await Promise.all(
        pageRaw.map(async (lab) => {
          const latest = await this.submissionStore.listSubmissionsPageAsync(
            lab.id,
            userId,
            null,
            1,
          );
          return {
            ...this.labsService.toStudentView(lab, cls.code),
            latestStudentVerdict: latest[0]?.overallVerdict ?? null,
          };
        }),
      );
      return {
        items: studentItems,
        nextCursor,
      };
    }

    const enrichedItems = await Promise.all(
      pageRaw.map(async (lab) => {
        const [subs, queueEntries] = await Promise.all([
          this.submissionStore.listLabSubmissionsAsync(lab.id),
          this.submissionStore.listLabReviewQueueAsync(lab.id, 'counted'),
        ]);
        const pendingReviewCount = queueEntries.reduce(
          (sum, entry) =>
            sum + entry.findings.filter((f) => f.reviewStatus === 'PENDING_REVIEW').length,
          0,
        );
        return {
          ...lab,
          classCode: cls.code,
          submissionCount: subs.length,
          pendingReviewCount,
        };
      }),
    );
    return {
      items: enrichedItems,
      nextCursor,
    };
  }

  async createClassLab(
    classId: string,
    userId: string,
    role: UserRole,
    input: CreateLabInput,
    idempotencyKey?: string,
  ): Promise<Lab> {
    if (role !== 'TA') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only TAs may create labs.');
    }
    return this.labsService.createLab(userId, { ...input, classId }, idempotencyKey);
  }

  private async assertClassReadable(
    classId: string,
    userId: string,
    role: UserRole,
  ): Promise<ClassSummaryRecord> {
    const cls = await this.classesStore.getClassByIdAsync(classId);
    if (!cls) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `The requested class with ID '${classId}' does not exist.`,
      );
    }
    if (role === 'ADMIN') {
      return cls;
    }
    if (role === 'TA') {
      const managed = await this.authStore.taClassesAsync(userId);
      if (!managed.includes(classId)) {
        throw problemException(
          HttpStatus.FORBIDDEN,
          'You are not authorized to access resources in this class.',
        );
      }
      return cls;
    }
    const enrolled = await this.authStore.activeClassesAsync(userId);
    if (!enrolled.includes(classId)) {
      throw problemException(HttpStatus.FORBIDDEN, 'You are not enrolled in this class.');
    }
    return cls;
  }
}
