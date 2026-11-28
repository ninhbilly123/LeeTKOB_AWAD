import { Injectable, Optional } from '@nestjs/common';
import { compareDescTimestampId, isAfterDescKeyset, KeysetCursor } from '../common/pagination';
import { OptionalIdempotencyParams, PostgresPersistence } from '../persistence/postgres.store';
import { Lab } from '../submissions/submissions.types';

const DEFAULT_LAB_CREATED_AT = '2026-11-01T00:00:00.000Z';

/** Dual-mode lab store: PostgreSQL when enabled, in-memory for offline tests. */
@Injectable()
export class LabsStore {
  private readonly labs = new Map<string, Lab>();

  constructor(@Optional() private readonly postgres?: PostgresPersistence) {}

  private get usePostgres(): boolean {
    return Boolean(this.postgres?.isEnabled());
  }

  // --- In-memory helpers (used by offline tests) ---

  resetLabs(labs: Lab[] = []): void {
    this.labs.clear();
    const baseMs = Date.parse(DEFAULT_LAB_CREATED_AT);
    labs.forEach((lab, idx) => {
      this.labs.set(lab.id, {
        ...lab,
        createdAt: lab.createdAt ?? new Date(baseMs + idx * 1000).toISOString(),
      });
    });
  }

  getLab(id: string): Lab | undefined {
    return this.labs.get(id);
  }

  saveLab(lab: Lab): void {
    const existing = this.labs.get(lab.id);
    this.labs.set(lab.id, {
      ...lab,
      createdAt: lab.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
      testCases: lab.testCases ? lab.testCases.map((tc) => ({ ...tc })) : undefined,
      constraints: lab.constraints ? lab.constraints.map((c) => ({ ...c })) : undefined,
    });
  }

  getAllLabs(): Lab[] {
    return [...this.labs.values()].sort((a, b) =>
      compareDescTimestampId(
        a.createdAt ?? DEFAULT_LAB_CREATED_AT,
        a.id,
        b.createdAt ?? DEFAULT_LAB_CREATED_AT,
        b.id,
      ),
    );
  }

  // --- Async dual-mode (Postgres or in-memory) ---

  async getLabAsync(id: string): Promise<Lab | undefined> {
    if (this.usePostgres) {
      return this.postgres!.getLab(id);
    }
    return this.getLab(id);
  }

  /**
   * Student-safe lab read: filters hidden test cases at the SQL layer when PostgreSQL is enabled.
   */
  async getStudentLabAsync(id: string): Promise<Lab | undefined> {
    if (this.usePostgres) {
      return this.postgres!.getStudentLab(id);
    }
    const lab = this.getLab(id);
    if (!lab) {
      return undefined;
    }
    return {
      ...lab,
      testCases: (lab.testCases ?? []).filter((tc) => !tc.isHidden),
    };
  }

  async saveLabAsync(lab: Lab, idempotency?: OptionalIdempotencyParams): Promise<Lab> {
    if (this.usePostgres) {
      return this.postgres!.saveLab(lab, idempotency);
    }
    const toStore: Lab = {
      ...lab,
      createdAt: lab.createdAt ?? this.labs.get(lab.id)?.createdAt ?? new Date().toISOString(),
    };
    this.saveLab(toStore);
    return toStore;
  }

  async getAllLabsAsync(allowedClassIds?: string[] | null, studentOnly = false): Promise<Lab[]> {
    if (this.usePostgres) {
      return this.postgres!.getAllLabs(allowedClassIds, studentOnly);
    }
    const all = this.getAllLabs().filter(
      (lab) =>
        allowedClassIds === undefined ||
        allowedClassIds === null ||
        allowedClassIds.includes(lab.classId),
    );
    if (!studentOnly) {
      return all;
    }
    return all.map((lab) => ({
      ...lab,
      testCases: (lab.testCases ?? []).filter((tc) => !tc.isHidden),
    }));
  }

  /** Keyset-paginated class labs lookup returning up to limit + 1 records. */
  async listClassLabsPageAsync(
    classId: string,
    studentOnly: boolean,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<Lab[]> {
    if (this.usePostgres) {
      return this.postgres!.listClassLabsPage(classId, studentOnly, cursor, limit);
    }
    const all = await this.getAllLabsAsync([classId], studentOnly);
    const filtered = cursor
      ? all.filter((lab) =>
          isAfterDescKeyset(lab.createdAt ?? DEFAULT_LAB_CREATED_AT, lab.id, cursor),
        )
      : all;
    return filtered.slice(0, limit + 1);
  }
}
