import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, JwtAuthenticatedRequest } from '../common/guards/jwt-auth.guard';
import { assertJsonContentType, problemException } from '../common/http-problems';
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

    if (
      !body ||
      rawIdentifier.length === 0 ||
      typeof body.password !== 'string' ||
      body.password.length === 0
    ) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Both username (or email) and password must be non-empty strings.',
      );
    }

    return this.authService.login(rawIdentifier, body.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: JwtAuthenticatedRequest): Promise<UserProfile> {
    return this.authService.getCurrentUser(req.user.id);
  }
}
