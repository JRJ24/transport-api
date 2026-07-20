import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  type SendNotificationJob,
} from '../notification.queue';
import { PushDeliveryService } from '../push-delivery.service';

/**
 * BullMQ worker that delivers queued push notifications with retries/backoff.
 * Only registered when a Redis-backed queue is configured.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly pushDelivery: PushDeliveryService) {
    super();
  }

  async process(job: Job<SendNotificationJob>): Promise<void> {
    this.logger.debug(`Processing push job ${job.id}`);
    await this.pushDelivery.deliver(job.data.notificationId);
  }
}
