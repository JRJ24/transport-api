import type { Request } from 'express';
import type { RequestContext } from '../interfaces/request-context.interface';

export function extractRequestContext(request: Request): RequestContext {
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  };
}
