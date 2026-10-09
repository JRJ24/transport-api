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
  // Cuerpo o archivo demasiado grande (body-parser, o Multer con
  // LIMIT_FILE_SIZE) y tipo/charset no soportado: errores del cliente. No hay
  // codigo propio en ERROR_CODES y BAD_REQUEST es el mas cercano; antes salian
  // como INTERNAL_ERROR.
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.BAD_REQUEST,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ERROR_CODES.BAD_REQUEST,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.DOMAIN_RULE_VIOLATION,
  [HttpStatus.BAD_GATEWAY]: ERROR_CODES.UPSTREAM_ERROR,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
  [HttpStatus.GATEWAY_TIMEOUT]: ERROR_CODES.UPSTREAM_TIMEOUT,
};

/** Un 4xx sin entrada propia sigue siendo culpa del cliente, no INTERNAL_ERROR. */
const codeForStatus = (status: number): string =>
  STATUS_TO_CODE[status] ??
  (status >= 400 && status < 500
    ? ERROR_CODES.BAD_REQUEST
    : ERROR_CODES.INTERNAL_ERROR);

/** Mensajes fijos para los 4xx de body-parser mas comunes. */
const CLIENT_ERROR_MESSAGES: Partial<Record<number, string>> = {
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Request body too large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported media type',
};

interface ExposedClientError {
  status: number;
  message: string;
  type?: string;
}

/**
 * Errores de http-errors (body-parser/raw-body: PayloadTooLargeError 413,
 * UnsupportedMediaTypeError 415, 'request aborted' 400...). No son
 * HttpException y Nest solo convierte el SyntaxError del JSON roto, asi que
 * caian como 500 y en el log de no manejados. expose === true es la marca de
 * http-errors de que el mensaje es apto para el cliente; sin ella (o en 5xx)
 * se sigue respondiendo 500. Un AxiosError trae status pero no expose: el 404
 * de un proveedor no se convierte en un 404 nuestro.
 */
function asExposedClientError(exception: unknown): ExposedClientError | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const candidate = exception as Record<string, unknown>;
  if (candidate.expose !== true) return null;

  const status = candidate.status ?? candidate.statusCode;
  if (
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 400 ||
    status > 499
  ) {
    return null;
  }

  return {
    status,
    message: typeof candidate.message === 'string' ? candidate.message : '',
    type: typeof candidate.type === 'string' ? candidate.type : undefined,
  };
}

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
      code = codeForStatus(status);

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
      const clientError = asExposedClientError(exception);
      if (clientError) {
        status = clientError.status;
        code = codeForStatus(status);
        message =
          CLIENT_ERROR_MESSAGES[status] ??
          (clientError.message || 'Bad request');
        // warn y no error: lo causa el cliente, pero un 413 repetido avisa de
        // que un limite (p. ej. el de JSON en main.ts) se quedo corto.
        this.logger.warn(
          `${request.method} ${request.url} rejected with ${status}${clientError.type ? ` (${clientError.type})` : ''}: ${clientError.message}`,
        );
      } else {
        const error =
          exception instanceof Error ? exception : new Error(String(exception));
        this.logger.error(
          `Unhandled exception on ${request.method} ${request.url}: ${error.message}`,
          error.stack,
        );
      }
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
