import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { assertJsonContentType, problemException } from '../common/http-problems';
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

    if (
      !body ||
      typeof body.username !== 'string' ||
      body.username.trim().length === 0 ||
      typeof body.password !== 'string' ||
      body.password.length === 0
    ) {
      throw problemException(
        HttpStatus.BAD_REQUEST,
        'Both username and password must be non-empty strings.',
      );
    }

    return this.authService.login(body.username.trim(), body.password);
  }
}
