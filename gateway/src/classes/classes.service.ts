import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthStore } from '../auth/auth.store';
import { problemException } from '../common/http-problems';
import { CreateLabInput } from '../labs/dto/create-lab.dto';
import { LabsService, LabStudentView } from '../labs/labs.service';
import { SubmissionStore } from '../submissions/submissions.store';
import { Lab, UserRole } from '../submissions/submissions.types';
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

interface DecodedCursor {
  offset: number;
}

function parsePaginationParams(
  rawCursor?: string,
  rawLimit?: string,
): { offset: number; limit: number } {
  let limit = 20;
  if (rawLimit !== undefined && rawLimit.trim() !== '') {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        "Query parameter 'limit' must be an integer between 1 and 100.",
      );
    }
    limit = parsed;
  }

  let offset = 0;
  if (rawCursor !== undefined && rawCursor.trim() !== '') {
    try {
      const json = Buffer.from(rawCursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(json) as Partial<DecodedCursor>;
      if (
        typeof parsed.offset !== 'number' ||
        !Number.isInteger(parsed.offset) ||
        parsed.offset < 0
      ) {
        throw new Error('Invalid cursor offset');
      }
      offset = parsed.offset;
    } catch {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        "Query parameter 'cursor' is malformed or invalid.",
      );
    }
  }
  return { offset, limit };
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function paginateItems<T>(all: T[], offset: number, limit: number): CursorPage<T> {
  const slice = all.slice(offset, offset + limit + 1);
  const hasMore = slice.length > limit;
  const items = hasMore ? slice.slice(0, limit) : slice;
  return {
    items,
    nextCursor: hasMore ? encodeCursor(offset + limit) : null,
  };
}

@Injectable()
export class ClassesService {
  constructor(
    private readonly classesStore: ClassesStore,
    private readonly authStore: AuthStore,
    private readonly labsService: LabsService,
    private readonly submissionStore: SubmissionStore,
  ) {}

  async listClasses(
    userId: string,
    role: UserRole,
    rawCursor?: string,
    rawLimit?: string,
  ): Promise<CursorPage<ClassSummaryRecord>> {
    const { offset, limit } = parsePaginationParams(rawCursor, rawLimit);
    const [classes, visibleLabs] = await Promise.all([
      this.classesStore.listClassesForUserAsync(userId, role),
      this.labsService.listLabs(userId, role),
    ]);

    const labCountByClass = new Map<string, number>();
    for (const lab of visibleLabs) {
      labCountByClass.set(lab.classId, (labCountByClass.get(lab.classId) ?? 0) + 1);
    }

    const enriched = classes.map((cls) => ({
      ...cls,
      labCount: labCountByClass.get(cls.id) ?? cls.labCount,
    }));
    return paginateItems(enriched, offset, limit);
  }

  async createClass(
    actorId: string,
    actorRole: UserRole,
    input: CreateClassPayload,
  ): Promise<ClassSummaryRecord> {
    if (actorRole !== 'ADMIN') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only ADMIN users may create classes (FAQ-01).');
    }

    const existing = await this.classesStore.listClassesForUserAsync(actorId, 'ADMIN');
    if (existing.some((c) => c.code.toLowerCase() === input.code.toLowerCase())) {
      throw problemException(HttpStatus.CONFLICT, `Class code '${input.code}' already exists.`);
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
      createdAt: new Date().toISOString(),
    };
    return this.classesStore.createClassAsync(record);
  }

  async listClassLabs(
    classId: string,
    userId: string,
    role: UserRole,
    rawCursor?: string,
    rawLimit?: string,
  ): Promise<
    CursorPage<(Lab | LabStudentView) & { submissionCount?: number; pendingReviewCount?: number }>
  > {
    const { offset, limit } = parsePaginationParams(rawCursor, rawLimit);
    await this.assertClassReadable(classId, userId, role);
    const allLabs = await this.labsService.listLabs(userId, role);
    const filtered = allLabs.filter((lab) => lab.classId === classId);
    const page = paginateItems(filtered, offset, limit);
    if (role === 'STUDENT') {
      return page;
    }
    const enrichedItems = await Promise.all(
      page.items.map(async (lab) => {
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
          submissionCount: subs.length,
          pendingReviewCount,
        };
      }),
    );
    return {
      items: enrichedItems,
      nextCursor: page.nextCursor,
    };
  }

  async createClassLab(
    classId: string,
    userId: string,
    role: UserRole,
    input: CreateLabInput,
  ): Promise<Lab> {
    if (role !== 'TA') {
      throw problemException(HttpStatus.FORBIDDEN, 'Only TAs may create labs.');
    }
    return this.labsService.createLab(userId, { ...input, classId });
  }

  private async assertClassReadable(
    classId: string,
    userId: string,
    role: UserRole,
  ): Promise<void> {
    const cls = await this.classesStore.getClassByIdAsync(classId);
    if (!cls) {
      throw problemException(
        HttpStatus.NOT_FOUND,
        `The requested class with ID '${classId}' does not exist.`,
      );
    }
    if (role === 'ADMIN') {
      return;
    }
    if (role === 'TA') {
      const managed = await this.authStore.taClassesAsync(userId);
      if (!managed.includes(classId)) {
        throw problemException(
          HttpStatus.FORBIDDEN,
          'You are not authorized to access resources in this class.',
        );
      }
      return;
    }
    const enrolled = await this.authStore.activeClassesAsync(userId);
    if (!enrolled.includes(classId)) {
      throw problemException(HttpStatus.FORBIDDEN, 'You are not enrolled in this class.');
    }
  }
}
