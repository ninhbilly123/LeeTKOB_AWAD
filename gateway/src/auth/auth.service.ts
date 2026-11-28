import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_VERIFICATION_SECRET } from '../common/auth.constants';
import { problemException } from '../common/http-problems';
import { AuthStore } from './auth.store';
import { UserProfile } from '../submissions/submissions.types';
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
}
