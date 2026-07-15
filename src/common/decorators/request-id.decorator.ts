import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Injects the request correlation id assigned by the logger (pino-http).
 */
export const RequestId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const id: unknown = request.id;

    return typeof id === 'string' ? id : undefined;
  },
);
