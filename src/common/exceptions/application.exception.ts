import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '../constants/error-codes.constant';

/**
 * Application-level error carrying a machine-readable code, rendered by the
 * AllExceptionsFilter with the standard API error envelope.
 */
export class ApplicationException extends HttpException {
  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}
