import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@generated/prisma/client';
import { ERROR_CODES } from '../constants/error-codes.constant';
import type { ApiErrorResponse } from '../interfaces/api-response.interface';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: InstanceType<typeof Prisma.PrismaClientKnownRequestError>,
    host: ArgumentsHost,
  ): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    switch (exception.code) {
      case 'P2002': {
        status = HttpStatus.CONFLICT;
        code = ERROR_CODES.RESOURCE_CONFLICT;
        const target = exception.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : undefined;
        message = fields
          ? `A record with the same ${fields} already exists`
          : 'A record with the same unique value already exists';
        details = exception.meta;
        break;
      }
      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        code = ERROR_CODES.RESOURCE_NOT_FOUND;
        message = 'The requested record was not found';
        break;
      case 'P2003':
        status = HttpStatus.CONFLICT;
        code = ERROR_CODES.RESOURCE_CONFLICT;
        message = 'The operation violates a relation constraint';
        break;
      default:
        this.logger.error(
          `Unhandled Prisma error ${exception.code} on ${request.method} ${request.url}: ${exception.message}`,
          exception.stack,
        );
    }

    const requestId = typeof request.id === 'string' ? request.id : undefined;

    const payload: ApiErrorResponse = {
      success: false,
      error: { code, message, ...(details !== undefined && { details }) },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    };

    response.status(status).json(payload);
  }
}
