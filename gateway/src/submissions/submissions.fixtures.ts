import { AuthenticatedUser, Lab, ClassMembership, Submission, IdempotencyRecord } from './submissions.types';

export const MOCK_LABS: Record<string, Lab> = {
  'lab_018f2d5e-7a91-7f3c-b26a-98124d63e001': {
    id: 'lab_018f2d5e-7a91-7f3c-b26a-98124d63e001',
    classId: 'class_cs101',
    title: 'Sorting Lab — Merge Sort',
    deadline: '2099-12-31T23:59:59.000Z', // Far future deadline (active)
    maxPayloadSize: 65536, // 64 KB
    isActive: true,
  },
  'lab_expired_001': {
    id: 'lab_expired_001',
    classId: 'class_cs101',
    title: 'Closed Sorting Lab',
    deadline: '2020-01-01T00:00:00.000Z', // Past deadline (expired)
    maxPayloadSize: 65536,
    isActive: true,
  },
};

export const MOCK_MEMBERSHIPS: ClassMembership[] = [
  {
    id: 'mem_001',
    studentId: 'std_23120244',
    classId: 'class_cs101',
    status: 'ACTIVE',
  },
  {
    id: 'mem_002',
    studentId: 'std_other_class',
    classId: 'class_diff202',
    status: 'ACTIVE',
  },
];

export const MOCK_USERS: Record<string, AuthenticatedUser> = {
  student_enrolled: {
    id: 'std_23120244',
    role: 'STUDENT',
    classIds: ['class_cs101'],
  },
  student_other_class: {
    id: 'std_other_class',
    role: 'STUDENT',
    classIds: ['class_diff202'],
  },
  ta_user: {
    id: 'usr_ta_01',
    role: 'TA',
    classIds: ['class_cs101'],
  },
  admin_user: {
    id: 'usr_admin_01',
    role: 'ADMIN',
    classIds: [],
  },
};

/**
 * In-memory repository stores to handle submissions and idempotency records
 * throughout unit and contract test executions.
 */
export class InMemorySubmissionStore {
  private submissions: Map<string, Submission> = new Map();
  private idempotencyRecords: Map<string, IdempotencyRecord> = new Map();

  reset(): void {
    this.submissions.clear();
    this.idempotencyRecords.clear();
  }

  saveSubmission(submission: Submission): void {
    this.submissions.set(submission.id, submission);
  }

  getSubmission(id: string): Submission | undefined {
    return this.submissions.get(id);
  }

  getAllSubmissions(): Submission[] {
    return Array.from(this.submissions.values());
  }

  getIdempotencyRecord(key: string): IdempotencyRecord | undefined {
    const record = this.idempotencyRecords.get(key);
    if (!record) return undefined;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      this.idempotencyRecords.delete(key);
      return undefined;
    }
    return record;
  }

  saveIdempotencyRecord(record: IdempotencyRecord): void {
    this.idempotencyRecords.set(record.key, record);
  }
}

export const submissionStore = new InMemorySubmissionStore();

