import { ERROR_CODES, type ErrorCode } from '../constants/error-codes.constant';

/**
 * Raised by domain rules (state transitions, invariants). Framework-agnostic:
 * the AllExceptionsFilter maps it to an HTTP 422 response.
 */
export class DomainException extends Error {
  constructor(
    readonly code: ErrorCode = ERROR_CODES.DOMAIN_RULE_VIOLATION,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainException';
  }
}
