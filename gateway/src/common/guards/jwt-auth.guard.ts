import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_VERIFICATION_SECRET } from '../auth.constants';
import { VerifiedJwtUser, verifyBearerClaims } from '../http-problems';
import { AuthenticatedRequest } from '../../submissions/submissions.types';

export interface JwtAuthenticatedRequest extends Omit<AuthenticatedRequest, 'user'> {
  user: VerifiedJwtUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(JWT_VERIFICATION_SECRET) private readonly secret: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<JwtAuthenticatedRequest>();
    request.user = verifyBearerClaims(request.headers.authorization, this.jwt, this.secret);
    return true;
  }
}
