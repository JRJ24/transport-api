import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { map, Observable } from 'rxjs';
import type { ApiSuccessResponse } from '../interfaces/api-response.interface';

/**
 * Wraps every successful response in the standard API envelope:
 * { success: true, data, meta: { requestId, timestamp } }
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}
