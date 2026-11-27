import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ClassMembership, ClassRecord, StoredUser } from '../submissions/submissions.types';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return hashPasswordWithSalt(password, salt);
}

/** Deterministic salt helper used exclusively for PA#3 demo seed repeatability. */
export function hashPasswordWithSalt(password: string, saltHex: string): string {
  const derived = scryptSync(password, saltHex, 64).toString('hex');
  return `${saltHex}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = scryptSync(password, salt, 64);
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

export const DEMO_CLASSES: ReadonlyArray<ClassRecord> = [
  {
    id: 'class_cs101',
    code: 'CSC10002-24CLC1',
    name: 'Kỹ thuật lập trình — Nhóm 1',
    term: 'HK1 2026-2027',
    createdBy: 'usr_admin_01',
  },
  {
    id: 'class_cs102',
    code: 'CSC10002-24CLC2',
    name: 'Kỹ thuật lập trình — Nhóm 2',
    term: 'HK1 2026-2027',
    createdBy: 'usr_admin_01',
  },
];

export const DEMO_USERS: ReadonlyArray<StoredUser> = [
  {
    id: 'usr_admin_01',
    username: 'admin',
    email: 'admin@leetkob.edu.vn',
    displayName: 'Quản trị viên (Admin)',
    passwordHash: hashPasswordWithSalt('admin123', 'a1b2c3d4e5f60718293a4b5c6d7e8f01'),
    role: 'ADMIN',
    classIds: [],
  },
  {
    id: 'usr_ta_01',
    username: 'ta1',
    email: 'ta1@leetkob.edu.vn',
    displayName: 'TA Nguyễn Minh Tuấn',
    passwordHash: hashPasswordWithSalt('ta123', 'a1b2c3d4e5f60718293a4b5c6d7e8f02'),
    role: 'TA',
    classIds: ['class_cs101'],
  },
  {
    id: 'usr_ta_02',
    username: 'ta2',
    email: 'ta2@leetkob.edu.vn',
    displayName: 'TA Trần Bảo Ngọc',
    passwordHash: hashPasswordWithSalt('ta123', 'a1b2c3d4e5f60718293a4b5c6d7e8f03'),
    role: 'TA',
    classIds: ['class_cs102'],
  },
  {
    id: 'std_23120244',
    username: 'student1',
    email: 'student1@leetkob.edu.vn',
    displayName: 'SV Nguyễn Nhật Duy (23120244)',
    passwordHash: hashPasswordWithSalt('student123', 'a1b2c3d4e5f60718293a4b5c6d7e8f04'),
    role: 'STUDENT',
    classIds: ['class_cs101'],
  },
  {
    id: 'std_second_student',
    username: 'student2',
    email: 'student2@leetkob.edu.vn',
    displayName: 'SV Phạm Gia Hân (23120002)',
    passwordHash: hashPasswordWithSalt('student123', 'a1b2c3d4e5f60718293a4b5c6d7e8f05'),
    role: 'STUDENT',
    classIds: ['class_cs101'],
  },
];

export const DEMO_STAFF: ReadonlyArray<{ classId: string; taId: string }> = [
  { classId: 'class_cs101', taId: 'usr_ta_01' },
  { classId: 'class_cs102', taId: 'usr_ta_02' },
];

export const DEMO_ENROLLMENTS: ReadonlyArray<ClassMembership> = [
  { id: 'mem_001', studentId: 'std_23120244', classId: 'class_cs101', status: 'ACTIVE' },
  { id: 'mem_003', studentId: 'std_second_student', classId: 'class_cs101', status: 'ACTIVE' },
];
