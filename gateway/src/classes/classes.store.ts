import { Injectable, Optional } from '@nestjs/common';
import { DEMO_CLASSES, DEMO_ENROLLMENTS, DEMO_STAFF } from '../auth/password.util';
import { PostgresPersistence } from '../persistence/postgres.store';
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

    const all = [...this.classes.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
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

  async createClassAsync(record: ClassSummaryRecord): Promise<ClassSummaryRecord> {
    if (this.usePostgres) {
      await this.postgres!.createClass(
        {
          id: record.id,
          code: record.code,
          name: record.name,
          term: record.term,
          inviteCode: record.inviteCode ?? null,
          createdBy: record.createdBy,
        },
        record.taIds,
      );
      return { ...record, taIds: [...record.taIds] };
    }
    const stored: ClassSummaryRecord = { ...record, taIds: [...record.taIds] };
    this.classes.set(stored.id, stored);
    return { ...stored, taIds: [...stored.taIds] };
  }
}
