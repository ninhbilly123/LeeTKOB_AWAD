import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_VERIFICATION_SECRET } from '../common/auth.constants';
import { problemException } from '../common/http-problems';
import { encodeKeysetCursor, parseKeysetPagination } from '../common/pagination';
import { AuthStore } from './auth.store';
import { UserProfile, UserRole } from '../submissions/submissions.types';
import { verifyPassword } from './password.util';

export interface LoginResponse {
  accessToken: string;
  user: UserProfile;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authStore: AuthStore,
    @Inject(JWT_VERIFICATION_SECRET) private readonly secret: string,
  ) {}

  async login(identifier: string, password: string): Promise<LoginResponse> {
    const user = await this.authStore.findUserByIdentifierAsync(identifier);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw problemException(HttpStatus.UNAUTHORIZED, 'Invalid username or password.');
    }

    const classIds =
      user.role === 'STUDENT'
        ? await this.authStore.activeClassesAsync(user.id)
        : [...user.classIds];

    const accessToken = this.jwtService.sign(
      { sub: user.id, role: user.role, classIds },
      { secret: this.secret, algorithm: 'HS256', expiresIn: '24h' },
    );

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        classIds,
      },
    };
  }

  async getCurrentUser(userId: string): Promise<UserProfile> {
    const user = await this.authStore.findUserByIdAsync(userId);
    if (!user) {
      throw problemException(
        HttpStatus.UNAUTHORIZED,
        'Authentication token is missing, invalid, or has expired.',
      );
    }
    const classIds =
      user.role === 'STUDENT'
        ? await this.authStore.activeClassesAsync(user.id)
        : [...user.classIds];

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      classIds,
    };
  }

  async listUsers(
    rawRole?: string,
    rawCursor?: string,
    rawLimit?: string,
  ): Promise<{ items: UserProfile[]; nextCursor: string | null }> {
    let role: UserRole | null = null;
    if (rawRole !== undefined && rawRole.trim() !== '') {
      const normalized = rawRole.trim().toUpperCase();
      if (normalized !== 'STUDENT' && normalized !== 'TA' && normalized !== 'ADMIN') {
        throw problemException(
          HttpStatus.BAD_REQUEST,
          "Query parameter 'role' must be one of 'STUDENT', 'TA', or 'ADMIN'.",
        );
      }
      role = normalized;
    }

    const scope = `users:${role ?? 'all'}`;
    const { cursor, limit } = parseKeysetPagination(rawCursor, rawLimit, scope, {
      defaultLimit: 50,
    });
    const rows = await this.authStore.listUsersPageAsync(role, cursor, limit);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];

    return {
      items: pageRows.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        classIds: u.classIds,
      })),
      nextCursor:
        hasMore && last ? encodeKeysetCursor({ s: scope, t: last.createdAt, id: last.id }) : null,
    };
  }
}
