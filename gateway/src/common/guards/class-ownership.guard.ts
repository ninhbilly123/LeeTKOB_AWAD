import { Injectable, Inject, CanActivate, ExecutionContext, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_VERIFICATION_SECRET } from '../auth.constants';
import { problemException, verifyBearerClaims } from '../http-problems';
import { AuthStore } from '../../auth/auth.store';
import { LabsStore } from '../../labs/labs.store';
import { AuthenticatedRequest } from '../../submissions/submissions.types';

@Injectable()
export class ClassOwnershipGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly authStore: AuthStore,
    private readonly labsStore: LabsStore,
    @Inject(JWT_VERIFICATION_SECRET) private readonly secret: string,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const verified = verifyBearerClaims(request.headers.authorization, this.jwt, this.secret);

    if (verified.role !== 'STUDENT') {
      throw problemException(
        HttpStatus.FORBIDDEN,
        'Only students enrolled in this class may submit solution code.',
      );
    }

    const rawLabId = request.params.labId;
    const labId = Array.isArray(rawLabId) ? rawLabId[0] : rawLabId;
    const [lab, classIds] = await Promise.all([
      this.labsStore.getLabAsync(labId),
      this.authStore.activeClassesAsync(verified.id),
    ]);
    if (lab && !classIds.includes(lab.classId)) {
      throw problemException(
        HttpStatus.FORBIDDEN,
        'You are not enrolled in the class owning this lab.',
      );
    }
    request.user = { id: verified.id, role: verified.role, classIds };
    return true;
  }
}
