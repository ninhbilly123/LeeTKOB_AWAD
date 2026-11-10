import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { MOCK_USERS, MOCK_LABS } from '../../submissions/submissions.fixtures';

@Injectable()
export class ClassOwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
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

    const token = authHeader.substring(7).trim();

    let user = Object.values(MOCK_USERS).find((u) => u.id === token);
    if (!user) {
      if (token === 'valid_student_token') {
        user = MOCK_USERS.student_enrolled;
      } else if (token === 'other_class_token') {
        user = MOCK_USERS.student_other_class;
      } else if (token === 'ta_token') {
        user = MOCK_USERS.ta_user;
      } else if (token === 'admin_token') {
        user = MOCK_USERS.admin_user;
      }
    }

    if (!user || token === 'expired_token' || token === 'invalid_token') {
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

    // Role check: Only STUDENT role is permitted to submit code
    if (user.role !== 'STUDENT') {
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

    // Ownership check: Student must be enrolled in the class owning the specified lab
    const rawLabId = request.params.labId;
    const labId = Array.isArray(rawLabId) ? rawLabId[0] : rawLabId;
    if (labId && MOCK_LABS[labId]) {
      const targetLab = MOCK_LABS[labId];
      if (!user.classIds.includes(targetLab.classId)) {
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
    }

    (request as any).user = user;
    return true;
  }
}
