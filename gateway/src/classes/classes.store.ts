import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { DEMO_CLASSES, DEMO_ENROLLMENTS, DEMO_STAFF } from '../auth/password.util';
import { problemException } from '../common/http-problems';
import { compareDescTimestampId, isAfterDescKeyset, KeysetCursor } from '../common/pagination';
import { OptionalIdempotencyParams, PostgresPersistence } from '../persistence/postgres.store';
import { ClassRecord, UserRole } from '../submissions/submissions.types';

export interface ClassSummaryRecord extends ClassRecord {
  taIds: string[];
  studentCount: number;
  labCount: number;
  createdAt: string;
}

/** Dual-mode class store: PostgreSQL when enabled, in-memory for offline tests. */
@Injectable()
export class ClassesStore {
  private readonly classes = new Map<string, ClassSummaryRecord>();

  constructor(@Optional() private readonly postgres?: PostgresPersistence) {
    this.seedDefaults();
  }

  private get usePostgres(): boolean {
    return Boolean(this.postgres?.isEnabled());
  }

  seedDefaults(): void {
    this.classes.clear();
    const baseTime = Date.parse('2026-11-01T00:00:00.000Z');
    DEMO_CLASSES.forEach((cls, idx) => {
      const taIds = DEMO_STAFF.filter((s) => s.classId === cls.id).map((s) => s.taId);
      const studentCount = DEMO_ENROLLMENTS.filter(
        (e) => e.classId === cls.id && e.status === 'ACTIVE',
      ).length;
      this.classes.set(cls.id, {
        ...cls,
        taIds,
        studentCount,
        labCount: 0,
        createdAt: new Date(baseTime + idx * 1000).toISOString(),
      });
    });
  }

  async getClassByIdAsync(classId: string): Promise<ClassSummaryRecord | undefined> {
    if (this.usePostgres) {
      const all = await this.postgres!.listClassSummariesForUser('__admin__', 'ADMIN');
      return all.find((c) => c.id === classId);
    }
    const found = this.classes.get(classId);
    return found ? { ...found, taIds: [...found.taIds] } : undefined;
  }

  async listClassesForUserAsync(userId: string, role: UserRole): Promise<ClassSummaryRecord[]> {
    if (this.usePostgres) {
      return this.postgres!.listClassSummariesForUser(userId, role);
    }

    const all = [...this.classes.values()].sort((a, b) =>
      compareDescTimestampId(a.createdAt, a.id, b.createdAt, b.id),
    );
    if (role === 'ADMIN') {
      return all.map((c) => ({ ...c, taIds: [...c.taIds] }));
    }
    if (role === 'TA') {
      return all
        .filter((c) => c.taIds.includes(userId))
        .map((c) => ({ ...c, taIds: [...c.taIds] }));
    }
    const enrolledClassIds = new Set(
      DEMO_ENROLLMENTS.filter((e) => e.studentId === userId && e.status === 'ACTIVE').map(
        (e) => e.classId,
      ),
    );
    return all
      .filter((c) => enrolledClassIds.has(c.id))
      .map((c) => ({ ...c, taIds: [...c.taIds] }));
  }

  /** Keyset-paginated class summary lookup returning up to limit + 1 records. */
  async listClassesPageForUserAsync(
    userId: string,
    role: UserRole,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<ClassSummaryRecord[]> {
    if (this.usePostgres) {
      return this.postgres!.listClassSummariesPageForUser(userId, role, cursor, limit);
    }
    const all = await this.listClassesForUserAsync(userId, role);
    const filtered = cursor
      ? all.filter((item) => isAfterDescKeyset(item.createdAt, item.id, cursor))
      : all;
    return filtered.slice(0, limit + 1);
  }

  async createClassAsync(
    record: ClassSummaryRecord,
    idempotency?: OptionalIdempotencyParams,
  ): Promise<ClassSummaryRecord> {
    if (this.usePostgres) {
      const stored = await this.postgres!.createClass(
        {
          ...record,
          inviteCode: record.inviteCode ?? null,
          taIds: [...record.taIds],
        },
        record.taIds,
        idempotency,
      );
      return { ...stored, taIds: [...stored.taIds] };
    }

    const exists = [...this.classes.values()].some(
      (c) => c.code.toLowerCase() === record.code.toLowerCase(),
    );
    if (exists) {
      throw problemException(HttpStatus.CONFLICT, `Class code '${record.code}' already exists.`);
    }
    const stored: ClassSummaryRecord = { ...record, taIds: [...record.taIds] };
    this.classes.set(stored.id, stored);
    return { ...stored, taIds: [...stored.taIds] };
  }
}
