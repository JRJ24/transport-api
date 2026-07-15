import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES, type ErrorCode } from '../constants/error-codes.constant';
import { DomainException } from '../exceptions/domain.exception';
import type { ApiErrorResponse } from '../interfaces/api-response.interface';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.RESOURCE_NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.RESOURCE_CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR;

      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const parsed = body as Record<string, unknown>;

        if (typeof parsed.code === 'string') {
          code = parsed.code;
        }

        if (Array.isArray(parsed.message)) {
          // class-validator: message is an array of constraint violations
          code = ERROR_CODES.VALIDATION_FAILED;
          message = 'Validation failed';
          details = parsed.message;
        } else if (typeof parsed.message === 'string') {
          message = parsed.message;
        } else {
          message = exception.message;
        }

        if (parsed.details !== undefined) {
          details = parsed.details;
        }
      }
    } else if (exception instanceof DomainException) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else {
      const error =
        exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${error.message}`,
        error.stack,
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
