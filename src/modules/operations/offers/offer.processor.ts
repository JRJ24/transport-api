import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  DISPATCH_ORDER_JOB,
  DISPATCH_SWEEP_JOB,
  MATCHING_QUEUE,
  OFFER_EXPIRE_JOB,
  type DispatchOrderJob,
  type OfferExpireJob,
} from './offer.queue';
import { OffersService } from './offers.service';

/** Runs offer expiries and the periodic dispatch sweep, one job at a time. */
@Processor(MATCHING_QUEUE, { concurrency: 1 })
export class OfferProcessor extends WorkerHost {
  private readonly logger = new Logger(OfferProcessor.name);

  constructor(private readonly offers: OffersService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case OFFER_EXPIRE_JOB:
        await this.offers.expire((job.data as OfferExpireJob).offerId);
        return;
      case DISPATCH_SWEEP_JOB:
        await this.offers.sweep();
        return;
      case DISPATCH_ORDER_JOB:
        await this.offers.onOrderDispatchable(
          (job.data as DispatchOrderJob).orderId,
        );
        return;
      default:
        this.logger.warn(`Unknown matching job ${job.name}`);
    }
  }
}
