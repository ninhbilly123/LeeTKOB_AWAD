import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Rfc9457ProblemDetails } from '../../submissions/submissions.types';

@Catch()
export class Rfc9457ExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'An unexpected internal error occurred.';
    let type = 'https://leetkob.edu.vn/errors/internal-server-error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        title = resObj.title || exception.message || this.getDefaultTitle(status);
        detail =
          resObj.detail ||
          (Array.isArray(resObj.message) ? resObj.message.join('; ') : resObj.message) ||
          exception.message;
        type = resObj.type || this.getDefaultType(status);
      } else if (typeof res === 'string') {
        detail = res;
        title = this.getDefaultTitle(status);
        type = this.getDefaultType(status);
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
    }

    const problemDetails: Rfc9457ProblemDetails = {
      type,
      title,
      status,
      detail,
      instance: request.originalUrl || request.url,
    };

    response
      .status(status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(problemDetails);
  }

  private getDefaultTitle(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'Bad Request';
      case HttpStatus.UNAUTHORIZED:
        return 'Unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'Forbidden';
      case HttpStatus.NOT_FOUND:
        return 'Not Found';
      case HttpStatus.CONFLICT:
        return 'Conflict';
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return 'Unsupported Media Type';
      default:
        return 'HTTP Error';
    }
  }

  private getDefaultType(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'https://leetkob.edu.vn/errors/bad-request';
      case HttpStatus.UNAUTHORIZED:
        return 'https://leetkob.edu.vn/errors/unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'https://leetkob.edu.vn/errors/forbidden';
      case HttpStatus.NOT_FOUND:
        return 'https://leetkob.edu.vn/errors/not-found';
      case HttpStatus.CONFLICT:
        return 'https://leetkob.edu.vn/errors/conflict';
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return 'https://leetkob.edu.vn/errors/unsupported-media-type';
      default:
        return 'https://leetkob.edu.vn/errors/internal-server-error';
    }
  }
}
