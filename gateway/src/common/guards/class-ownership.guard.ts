import {
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_VERIFICATION_SECRET } from '../auth.constants';
import { SubmissionStore } from '../../submissions/submissions.store';
import { AuthenticatedRequest, UserRole } from '../../submissions/submissions.types';

@Injectable()
export class ClassOwnershipGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly store: SubmissionStore,
    @Inject(JWT_VERIFICATION_SECRET) private readonly secret: string,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization || '');
    let claims: Record<string, unknown>;
    try {
      if (!match) throw new Error('Missing bearer token');
      claims = this.jwt.verify<Record<string, unknown>>(match[1], {
        secret: this.secret,
        algorithms: ['HS256'],
      });
      if (
        typeof claims.sub !== 'string' ||
        !claims.sub.trim() ||
        typeof claims.exp !== 'number' ||
        !['STUDENT', 'TA', 'ADMIN'].includes(String(claims.role))
      )
        throw new Error('Invalid token claims');
    } catch {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/unauthorized',
          title: 'Unauthorized',
          status: HttpStatus.UNAUTHORIZED,
          detail: 'Authentication token is missing, invalid, or has expired.',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (claims.role !== 'STUDENT') {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/forbidden',
          title: 'Forbidden',
          status: HttpStatus.FORBIDDEN,
          detail: 'Only students enrolled in this class may submit solution code.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const studentId = claims.sub as string;
    const rawLabId = request.params.labId;
    const labId = Array.isArray(rawLabId) ? rawLabId[0] : rawLabId;
    const lab = this.store.getLab(labId);
    const classIds = this.store.activeClasses(studentId);
    if (lab && !classIds.includes(lab.classId)) {
      throw new HttpException(
        {
          type: 'https://leetkob.edu.vn/errors/forbidden',
          title: 'Forbidden',
          status: HttpStatus.FORBIDDEN,
          detail: 'You are not enrolled in the class owning this lab.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    request.user = { id: studentId, role: claims.role as UserRole, classIds };
    return true;
  }
}
