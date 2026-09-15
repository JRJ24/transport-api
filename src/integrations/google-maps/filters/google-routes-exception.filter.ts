import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { ApiErrorResponse } from '@/common/interfaces/api-response.interface';
import { GoogleRoutesError } from '../errors/google-routes.error';

/**
 * Turns a `GoogleRoutesError` into a typed HTTP response.
 *
 * Without this the error is a plain `Error`, so `AllExceptionsFilter` falls
 * into its generic branch and every provider hiccup reaches the browser as a
 * bare 500 `INTERNAL_ERROR` with no way to tell "Google is down" from "our code
 * crashed". The provider payload is logged, never serialized.
 */
@Catch(GoogleRoutesError)
export class GoogleRoutesExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GoogleRoutesExceptionFilter.name);

  catch(exception: GoogleRoutesError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { code, message, status } = describe(exception);

    // 4xx from Google means our own request was malformed: that is a bug on our
    // side and deserves the stack, unlike a plain provider outage.
    const ourFault =
      exception.providerStatus === 400 || exception.providerStatus === 404;

    this.logger[ourFault ? 'error' : 'warn'](
      `Routes provider failed on ${request.method} ${request.url}: reason=${exception.reason} providerStatus=${exception.providerStatus ?? 'n/a'} -> ${status}`,
      ourFault ? JSON.stringify(exception.providerDetail) : undefined,
    );

    const payload: ApiErrorResponse = {
      success: false,
      error: { code, message },
      meta: {
        requestId: typeof request.id === 'string' ? request.id : undefined,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    };

    response.status(status).json(payload);
  }
}

function describe(exception: GoogleRoutesError): {
  code: string;
  message: string;
  status: number;
} {
  switch (exception.reason) {
    case 'no-route':
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ERROR_CODES.ROUTE_NOT_FOUND,
        message: 'No encontramos una ruta por carretera entre esas paradas',
      };
    case 'provider-denied':
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ERROR_CODES.MAPS_PROVIDER_DENIED,
        message:
          'El servicio de rutas no esta disponible (configuracion del proveedor)',
      };
    case 'provider-timeout':
      return {
        status: HttpStatus.GATEWAY_TIMEOUT,
        code: ERROR_CODES.UPSTREAM_TIMEOUT,
        message: 'El servicio de rutas tardo demasiado en responder',
      };
    default:
      if (
        exception.providerStatus === 400 ||
        exception.providerStatus === 404
      ) {
        return {
          status: HttpStatus.BAD_GATEWAY,
          code: ERROR_CODES.UPSTREAM_ERROR,
          message: 'El servicio de rutas rechazo la peticion',
        };
      }

      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: ERROR_CODES.ROUTE_PROVIDER_UNAVAILABLE,
        message: 'El servicio de rutas no esta disponible temporalmente',
      };
  }
}
