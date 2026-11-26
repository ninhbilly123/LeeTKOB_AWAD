import { Injectable, Optional } from '@nestjs/common';
import { DEMO_USERS } from './password.util';
import { PostgresPersistence } from '../persistence/postgres.store';
import { ClassMembership, StoredUser } from '../submissions/submissions.types';

const DEFAULT_DEMO_MEMBERSHIPS: ClassMembership[] = [
  { id: 'mem_001', studentId: 'std_23120244', classId: 'class_cs101', status: 'ACTIVE' },
  { id: 'mem_003', studentId: 'std_second_student', classId: 'class_cs101', status: 'ACTIVE' },
];

/** Dual-mode user store: PostgreSQL when enabled, in-memory for offline tests. */
@Injectable()
export class AuthStore {
  private readonly users = new Map<string, StoredUser>();
  private memberships: ClassMembership[] = [];

  constructor(@Optional() private readonly postgres?: PostgresPersistence) {
    this.seedDefaults();
  }

  seedDefaults(memberships: ClassMembership[] = DEFAULT_DEMO_MEMBERSHIPS): void {
    this.users.clear();
    for (const user of DEMO_USERS) {
      this.users.set(user.username, { ...user, classIds: [...user.classIds] });
    }
    this.memberships = memberships.map((m) => ({ ...m }));
  }

  private get usePostgres(): boolean {
    return Boolean(this.postgres?.isEnabled());
  }

  // --- User Lookups ---

  findUserByUsername(username: string): StoredUser | undefined {
    const user = this.users.get(username);
    return user ? { ...user, classIds: [...user.classIds] } : undefined;
  }

  async findUserByUsernameAsync(username: string): Promise<StoredUser | undefined> {
    if (this.usePostgres) {
      return this.postgres!.findUserByUsername(username);
    }
    return this.findUserByUsername(username);
  }

  findUserById(id: string): StoredUser | undefined {
    for (const user of this.users.values()) {
      if (user.id === id) {
        return { ...user, classIds: [...user.classIds] };
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

  // --- Class Membership ---

  taClasses(userId: string): string[] {
    const user = this.findUserById(userId);
    if (!user || user.role !== 'TA') {
      return [];
    }
    return [...user.classIds];
  }

  async taClassesAsync(userId: string): Promise<string[]> {
    const user = await this.findUserByIdAsync(userId);
    if (!user || user.role !== 'TA') {
      return [];
    }
    return [...user.classIds];
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
