import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, JwtAuthenticatedRequest } from '../common/guards/jwt-auth.guard';
import {
  assertJsonContentType,
  problemException,
  ValidationFieldError,
} from '../common/http-problems';
import { UserProfile } from '../submissions/submissions.types';
import { AuthService, LoginResponse } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: Record<string, unknown>,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<LoginResponse> {
    assertJsonContentType(contentType);

    const rawIdentifier =
      body && typeof body.username === 'string' && body.username.trim().length > 0
        ? body.username.trim()
        : body && typeof body.email === 'string' && body.email.trim().length > 0
          ? body.email.trim()
          : '';

    const fieldErrors: ValidationFieldError[] = [];
    if (!body || rawIdentifier.length === 0) {
      fieldErrors.push({
        field: 'username',
        message: 'Field username (or email) must be a non-empty string.',
      });
    }
    if (!body || typeof body.password !== 'string' || body.password.length === 0) {
      fieldErrors.push({
        field: 'password',
        message: 'Field password must be a non-empty string.',
      });
    }

    if (fieldErrors.length > 0) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Both username (or email) and password must be non-empty strings.',
        undefined,
        fieldErrors,
      );
    }

    return this.authService.login(rawIdentifier, body.password as string);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: JwtAuthenticatedRequest): Promise<UserProfile> {
    return this.authService.getCurrentUser(req.user.id);
  }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  async listUsers(
    @Req() req: JwtAuthenticatedRequest,
    @Query('role') role?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<{ items: UserProfile[]; nextCursor: string | null }> {
    if (req.user.role !== 'ADMIN') {
      throw problemException(
        HttpStatus.FORBIDDEN,
        'Only ADMIN users may list directory users (FAQ-01).',
      );
    }
    return this.authService.listUsers(role, cursor, limit);
  }
}
