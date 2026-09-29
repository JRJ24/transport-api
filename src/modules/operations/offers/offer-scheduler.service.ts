import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { matchingConfig } from '@/config';
import {
  DISPATCH_SWEEP_JOB,
  MATCHING_QUEUE,
  OFFER_EXPIRE_JOB,
  type OfferExpireJob,
} from './offer.queue';

/**
 * Timers for the offer cascade. Expiry is a delayed job per offer; the sweep
 * is a repeatable job, so with several API instances only one worker runs
 * each tick. Without a queue both are no-ops (and auto mode is off).
 */
@Injectable()
export class OfferSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(OfferSchedulerService.name);

  constructor(
    @Inject(matchingConfig.KEY)
    private readonly config: ConfigType<typeof matchingConfig>,
    @Optional()
    @Inject(getQueueToken(MATCHING_QUEUE))
    private readonly queue?: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) {
      return;
    }
    try {
      await this.queue.upsertJobScheduler(
        DISPATCH_SWEEP_JOB,
        { every: this.config.sweepIntervalMs },
        { name: DISPATCH_SWEEP_JOB, opts: { removeOnComplete: true } },
      );
    } catch (error) {
      this.logger.error(
        `Could not schedule the dispatch sweep: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async scheduleExpiry(offerId: string, delaySec: number): Promise<void> {
    if (!this.queue) {
      return;
    }
    const data: OfferExpireJob = { offerId };
    // The sweep expires overdue offers too, so a lost job only delays the
    // cascade by one sweep interval instead of stalling it.
    await this.queue
      .add(OFFER_EXPIRE_JOB, data, {
        delay: delaySec * 1000 + 250,
        jobId: `expire-${offerId}`,
        removeOnComplete: true,
        removeOnFail: 100,
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Could not schedule expiry for offer ${offerId}: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
  }
}
