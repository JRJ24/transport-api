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
import { RedisService } from '@/database/redis.service';
import {
  DISPATCH_SWEEP_JOB,
  DISPATCH_WAKE_JOB,
  MATCHING_QUEUE,
  OFFER_EXPIRE_JOB,
  SWEEP_ARMED_KEY,
  type OfferExpireJob,
} from './offer.queue';

/**
 * Timers for the offer cascade. Expiry is a delayed job per offer; the sweep
 * is a repeatable job, so with several API instances only one worker runs
 * each tick. Without a queue both are no-ops (and auto mode is off).
 *
 * The sweep only queries Postgres while it is «armed» (a Redis flag). It is
 * armed by activity (HTTP traffic, new offers, paid orders, startup) and the
 * sweep disarms it once the database shows nothing left to do. The 10 s tick
 * itself is Redis-only, so an idle API lets Neon suspend.
 */
@Injectable()
export class OfferSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(OfferSchedulerService.name);

  constructor(
    @Inject(matchingConfig.KEY)
    private readonly config: ConfigType<typeof matchingConfig>,
    private readonly redis: RedisService,
    @Optional()
    @Inject(getQueueToken(MATCHING_QUEUE))
    private readonly queue?: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) {
      return;
    }
    // After a restart there may be pending offers or orders: sweep once.
    await this.arm();
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

  /** Lets the sweep query the database on its next ticks. Never throws. */
  async arm(): Promise<void> {
    await this.redis.client?.set(SWEEP_ARMED_KEY, '1').catch(() => undefined);
  }

  async disarm(): Promise<void> {
    await this.redis.client?.del(SWEEP_ARMED_KEY).catch(() => undefined);
  }

  /**
   * Whether the sweep should run. Fail-open: without Redis, or if Redis
   * errors, it runs, because missing a dispatch is worse than a query.
   */
  async isArmed(): Promise<boolean> {
    const client = this.redis.client;
    if (!client) {
      return true;
    }
    try {
      return (await client.exists(SWEEP_ARMED_KEY)) > 0;
    } catch {
      return true;
    }
  }

  /** Re-arms the sweep at `at` (a scheduled order entering its window). */
  async scheduleWake(at: Date): Promise<void> {
    if (!this.queue) {
      return;
    }
    const delay = Math.max(0, at.getTime() - Date.now());
    await this.queue
      .add(
        DISPATCH_WAKE_JOB,
        {},
        {
          delay,
          // One wake per minute slot: repeated sweeps do not pile up jobs.
          jobId: `wake-${Math.floor(at.getTime() / 60_000)}`,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      )
      .catch((error: unknown) =>
        this.logger.error(
          `Could not schedule the dispatch wake-up: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
  }

  async scheduleExpiry(offerId: string, delaySec: number): Promise<void> {
    if (!this.queue) {
      return;
    }
    // A live offer is work for the sweep (expiry safety net).
    await this.arm();
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
