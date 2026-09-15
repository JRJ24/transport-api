import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Rate limit per authenticated user, falling back to the IP for public routes.
 *
 * The stock guard buckets by `req.ip`. Behind the nginx reverse proxy every
 * request arrives with the proxy's address, so the whole tenant shares a single
 * bucket and one busy user throttles everyone. Since the endpoints that most
 * need a limit (the billed Google Maps proxies) are all authenticated, the user
 * id is both the correct and the available key.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Request): Promise<string> {
    const user = (req as Request & { user?: AuthenticatedUser }).user;

    if (user?.id) {
      return Promise.resolve(`user:${user.id}`);
    }

    // `req.ips` is populated only when Express trusts the proxy; the first
    // entry is the original client. `req.ip` is the fallback for direct hits.
    const forwarded = req.ips?.[0];
    return Promise.resolve(`ip:${forwarded ?? req.ip ?? 'unknown'}`);
  }
}
