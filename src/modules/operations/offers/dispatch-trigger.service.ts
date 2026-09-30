import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  DISPATCH_ORDER_JOB,
  MATCHING_QUEUE,
  type DispatchOrderJob,
} from './offer.queue';
import { OffersService } from './offers.service';

/**
 * Wait before acting on "this order was just paid". Callers run inside the
 * payment transaction, so the handler must start after the commit; it then
 * re-reads the order and does nothing if the payment rolled back. If the
 * commit is slower than this, the periodic sweep still picks the order up.
 */
const AFTER_COMMIT_DELAY_MS = 1500;

/**
 * Entry point for billing to say "this order may be dispatchable now",
 * without billing depending on matching. Global through OffersModule.
 */
@Injectable()
export class DispatchTriggerService {
  private readonly logger = new Logger(DispatchTriggerService.name);

  constructor(
    private readonly offers: OffersService,
    @Optional()
    @Inject(getQueueToken(MATCHING_QUEUE))
    private readonly queue?: Queue,
  ) {}

  orderMaybeDispatchable(orderId: string): void {
    if (this.queue) {
      const data: DispatchOrderJob = { orderId };
      void this.queue
        .add(DISPATCH_ORDER_JOB, data, {
          delay: AFTER_COMMIT_DELAY_MS,
          // Several payments settling the same order collapse into one job.
          jobId: `dispatch-${orderId}-${Math.floor(Date.now() / 5000)}`,
          removeOnComplete: true,
          removeOnFail: 100,
        })
        .catch((error: unknown) =>
          this.logger.error(
            `Could not queue dispatch for order ${orderId}: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
        );
      return;
    }

    // No queue (local dev without Redis): still announce the paid order.
    setTimeout(() => {
      void this.offers
        .onOrderDispatchable(orderId)
        .catch((error: unknown) =>
          this.logger.error(
            `Dispatch trigger failed for order ${orderId}: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
        );
    }, AFTER_COMMIT_DELAY_MS).unref();
  }
}
