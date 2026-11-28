import { Injectable, Optional } from '@nestjs/common';
import { DEMO_ENROLLMENTS, DEMO_USERS } from './password.util';
import { compareDescTimestampId, isAfterDescKeyset, KeysetCursor } from '../common/pagination';
import { PostgresPersistence } from '../persistence/postgres.store';
import {
  ClassMembership,
  StoredUser,
  UserProfile,
  UserRole,
} from '../submissions/submissions.types';

interface InMemoryUserEntry {
  user: StoredUser;
  createdAt: string;
}

/** Dual-mode user store: PostgreSQL when enabled, in-memory for offline tests. */
@Injectable()
export class AuthStore {
  private readonly users = new Map<string, InMemoryUserEntry>();
  private memberships: ClassMembership[] = [];

  constructor(@Optional() private readonly postgres?: PostgresPersistence) {
    this.seedDefaults();
  }

  seedDefaults(memberships: ReadonlyArray<ClassMembership> = DEMO_ENROLLMENTS): void {
    this.users.clear();
    const baseMs = Date.parse('2026-11-01T00:00:00.000Z');
    DEMO_USERS.forEach((user, idx) => {
      this.users.set(user.username, {
        user: { ...user, classIds: [...user.classIds] },
        createdAt: new Date(baseMs + idx * 1000).toISOString(),
      });
    });
    this.memberships = memberships.map((m) => ({ ...m }));
  }

  private get usePostgres(): boolean {
    return Boolean(this.postgres?.isEnabled());
  }

  // --- User Lookups ---

  findUserByUsername(username: string): StoredUser | undefined {
    const entry = this.users.get(username);
    return entry ? { ...entry.user, classIds: [...entry.user.classIds] } : undefined;
  }

  findUserByEmail(email: string): StoredUser | undefined {
    const normalized = email.trim().toLowerCase();
    for (const entry of this.users.values()) {
      if (entry.user.email.toLowerCase() === normalized) {
        return { ...entry.user, classIds: [...entry.user.classIds] };
      }
    }
    return undefined;
  }

  async findUserByUsernameAsync(username: string): Promise<StoredUser | undefined> {
    if (this.usePostgres) {
      return this.postgres!.findUserByUsername(username);
    }
    return this.findUserByUsername(username);
  }

  async findUserByIdentifierAsync(identifier: string): Promise<StoredUser | undefined> {
    const trimmed = identifier.trim();
    if (this.usePostgres) {
      const byUsername = await this.postgres!.findUserByUsername(trimmed);
      if (byUsername) {
        return byUsername;
      }
      return this.postgres!.findUserByEmail(trimmed);
    }
    return this.findUserByUsername(trimmed) ?? this.findUserByEmail(trimmed);
  }

  findUserById(id: string): StoredUser | undefined {
    for (const entry of this.users.values()) {
      if (entry.user.id === id) {
        return { ...entry.user, classIds: [...entry.user.classIds] };
      }
    }
    return undefined;
  }

  async findUserByIdAsync(id: string): Promise<StoredUser | undefined> {
    if (this.usePostgres) {
      return this.postgres!.findUserById(id);
    }
    return this.findUserById(id);
  }

  async listUsersPageAsync(
    role: UserRole | null,
    cursor: KeysetCursor | null,
    limit: number,
  ): Promise<Array<UserProfile & { createdAt: string }>> {
    if (this.usePostgres) {
      return this.postgres!.listUsersPage(role, cursor, limit);
    }
    const all = [...this.users.values()]
      .filter((entry) => (role ? entry.user.role === role : true))
      .sort((a, b) => compareDescTimestampId(a.createdAt, a.user.id, b.createdAt, b.user.id))
      .map((entry) => ({
        id: entry.user.id,
        username: entry.user.username,
        email: entry.user.email,
        displayName: entry.user.displayName,
        role: entry.user.role,
        classIds:
          entry.user.role === 'STUDENT'
            ? this.activeClasses(entry.user.id)
            : [...entry.user.classIds],
        createdAt: entry.createdAt,
      }));
    const filtered = cursor
      ? all.filter((item) => isAfterDescKeyset(item.createdAt, item.id, cursor))
      : all;
    return filtered.slice(0, limit + 1);
  }

  // --- Class Membership & Staff ---

  /** Keeps in-memory TA staff assignments synchronized after POST /classes (parity with Postgres class_staff). */
  assignTasToClass(classId: string, taIds: ReadonlyArray<string>): void {
    if (this.usePostgres) {
      return;
    }
    for (const taId of taIds) {
      for (const entry of this.users.values()) {
        if (entry.user.id === taId && entry.user.role === 'TA') {
          if (!entry.user.classIds.includes(classId)) {
            entry.user.classIds.push(classId);
          }
        }
      }
    }
  }

  taClasses(userId: string): string[] {
    const user = this.findUserById(userId);
    if (!user || user.role !== 'TA') {
      return [];
    }
    return [...user.classIds];
  }

  async taClassesAsync(userId: string): Promise<string[]> {
    if (this.usePostgres) {
      return this.postgres!.taClasses(userId);
    }
    return this.taClasses(userId);
  }

  activeClasses(studentId: string): string[] {
    return this.memberships
      .filter((m) => m.studentId === studentId && m.status === 'ACTIVE')
      .map((m) => m.classId);
  }

  async activeClassesAsync(studentId: string): Promise<string[]> {
    if (this.usePostgres) {
      return this.postgres!.activeClasses(studentId);
    }
    return this.activeClasses(studentId);
  }
}
