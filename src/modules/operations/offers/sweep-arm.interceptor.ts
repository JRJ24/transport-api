import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { OfferSchedulerService } from './offer-scheduler.service';

/** At most one Redis SET per process in this window. */
const ARM_EVERY_MS = 30_000;

/**
 * Any HTTP request (payments, webhooks, accept/reject, staff edits) may
 * create dispatch work, and it already wakes the database anyway. So it
 * re-arms the sweep, which then checks Postgres until nothing is pending.
 * Health probes are skipped: they must not keep Neon awake.
 */
@Injectable()
export class SweepArmInterceptor implements NestInterceptor {
  private lastArmedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly scheduler: OfferSchedulerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const url =
        context.switchToHttp().getRequest<Request>().originalUrl ?? '';
      const now = Date.now();
      if (
        !/\/health(\/|\?|$)/.test(url) &&
        now - this.lastArmedAt >= ARM_EVERY_MS
      ) {
        this.lastArmedAt = now;
        void this.scheduler.arm();
      }
    }
    return next.handle();
  }
}
