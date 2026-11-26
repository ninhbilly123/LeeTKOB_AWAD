import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { StoredUser } from '../submissions/submissions.types';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
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

export const DEMO_USERS: ReadonlyArray<StoredUser> = [
  {
    id: 'usr_admin_01',
    username: 'admin',
    passwordHash: hashPassword('admin123'),
    role: 'ADMIN',
    classIds: [],
  },
  {
    id: 'usr_ta_01',
    username: 'ta1',
    passwordHash: hashPassword('ta123'),
    role: 'TA',
    classIds: ['class_cs101'],
  },
  {
    id: 'usr_ta_02',
    username: 'ta2',
    passwordHash: hashPassword('ta123'),
    role: 'TA',
    classIds: ['class_cs102'],
  },
  {
    id: 'std_23120244',
    username: 'student1',
    passwordHash: hashPassword('student123'),
    role: 'STUDENT',
    classIds: ['class_cs101'],
  },
  {
    id: 'std_second_student',
    username: 'student2',
    passwordHash: hashPassword('student123'),
    role: 'STUDENT',
    classIds: ['class_cs101'],
  },
];
