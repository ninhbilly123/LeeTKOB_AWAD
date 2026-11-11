import { Injectable } from '@nestjs/common';
import { ClassMembership, IdempotencyRecord, Lab, Submission } from './submissions.types';

/** Single-process PA#2 repository. Production persistence is a later checkpoint. */
@Injectable()
export class SubmissionStore {
  private readonly labs = new Map<string, Lab>();
  private memberships: ClassMembership[] = [];
  private readonly submissions = new Map<string, Submission>();
  private readonly idempotencyRecords = new Map<string, IdempotencyRecord>();

  reset(labs: Lab[] = [], memberships: ClassMembership[] = []): void {
    this.labs.clear();
    for (const lab of labs) this.labs.set(lab.id, { ...lab });
    this.memberships = memberships.map((membership) => ({ ...membership }));
    this.submissions.clear();
    this.idempotencyRecords.clear();
  }
  getLab(id: string): Lab | undefined {
    return this.labs.get(id);
  }
  activeClasses(studentId: string): string[] {
    return this.memberships
      .filter((membership) => membership.studentId === studentId && membership.status === 'ACTIVE')
      .map((membership) => membership.classId);
  }
  saveSubmission(submission: Submission): void {
    this.submissions.set(submission.id, submission);
  }
  getSubmission(id: string): Submission | undefined {
    return this.submissions.get(id);
  }
  getAllSubmissions(): Submission[] {
    return [...this.submissions.values()];
  }
  getIdempotencyRecord(studentId: string, key: string): IdempotencyRecord | undefined {
    const scopedKey = JSON.stringify([studentId, key]);
    const record = this.idempotencyRecords.get(scopedKey);
    if (record && Date.parse(record.expiresAt) <= Date.now()) {
      this.idempotencyRecords.delete(scopedKey);
      return undefined;
    }
    return record;
  }
  saveIdempotencyRecord(record: IdempotencyRecord): void {
    this.idempotencyRecords.set(JSON.stringify([record.studentId, record.key]), record);
  }
}
