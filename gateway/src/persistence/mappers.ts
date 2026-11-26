import {
  Lab,
  LabConstraint,
  LabTestCase,
  StoredUser,
  UserRole,
} from '../submissions/submissions.types';

export function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (value === undefined || value === null) {
    return fallback;
  }
  return value as T;
}

export function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

export function mapUserRow(row: Record<string, unknown>): StoredUser {
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    role: String(row.role) as UserRole,
    classIds: parseJsonColumn<string[]>(row.class_ids, []),
  };
}

export function mapLabRow(row: Record<string, unknown>): Lab {
  return {
    id: String(row.id),
    classId: String(row.class_id),
    title: String(row.title),
    statement: typeof row.statement === 'string' ? row.statement : '',
    deadline: toIsoString(row.deadline),
    maxPayloadSize: Number(row.max_payload_size ?? 65536),
    isActive: Boolean(row.is_active),
    testCases: parseJsonColumn<LabTestCase[]>(row.test_cases, []),
    constraints: parseJsonColumn<LabConstraint[]>(row.constraints, []),
    isPublished: Boolean(row.is_published),
  };
}
