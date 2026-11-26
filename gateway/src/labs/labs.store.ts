import { Injectable, Optional } from '@nestjs/common';
import { PostgresPersistence } from '../persistence/postgres.store';
import { Lab } from '../submissions/submissions.types';

/** Dual-mode lab store: PostgreSQL when enabled, in-memory for offline tests. */
@Injectable()
export class LabsStore {
  private readonly labs = new Map<string, Lab>();

  constructor(@Optional() private readonly postgres?: PostgresPersistence) {}

  private get usePostgres(): boolean {
    return Boolean(this.postgres?.isEnabled());
  }

  // --- In-memory helpers (used by tests) ---

  resetLabs(labs: Lab[] = []): void {
    this.labs.clear();
    for (const lab of labs) this.labs.set(lab.id, { ...lab });
  }

  getLab(id: string): Lab | undefined {
    return this.labs.get(id);
  }

  saveLab(lab: Lab): void {
    this.labs.set(lab.id, {
      ...lab,
      testCases: lab.testCases ? lab.testCases.map((tc) => ({ ...tc })) : undefined,
      constraints: lab.constraints ? lab.constraints.map((c) => ({ ...c })) : undefined,
    });
  }

  getAllLabs(): Lab[] {
    return [...this.labs.values()];
  }

  // --- Async dual-mode (Postgres or in-memory) ---

  async getLabAsync(id: string): Promise<Lab | undefined> {
    if (this.usePostgres) {
      return this.postgres!.getLab(id);
    }
    return this.getLab(id);
  }

  async saveLabAsync(lab: Lab): Promise<void> {
    if (this.usePostgres) {
      await this.postgres!.saveLab(lab);
      return;
    }
    this.saveLab(lab);
  }

  async getAllLabsAsync(): Promise<Lab[]> {
    if (this.usePostgres) {
      return this.postgres!.getAllLabs();
    }
    return this.getAllLabs();
  }
}
