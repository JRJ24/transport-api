import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { ConfigType } from '@nestjs/config';
import type { Notification } from '@generated/prisma/client';
import { NOTIFICATION_STATUS } from '@generated/prisma/enums';
import { Queue } from 'bullmq';
import { notificationConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import {
  NOTIFICATIONS_QUEUE,
  SEND_NOTIFICATION_JOB,
  type SendNotificationJob,
} from './notification.queue';
import { PushDeliveryService } from './push-delivery.service';
import {
  buildTemplate,
  type NotificationEvent,
  type TemplateContext,
} from './templates/notification.templates';

/**
 * Single entry point for emitting a notification: persists it, pushes it over
 * the websocket immediately, and schedules FCM delivery (BullMQ when Redis is
 * configured, otherwise inline). Operational code calls `dispatch(...)`.
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly pushDelivery: PushDeliveryService,
    @Inject(notificationConfig.KEY)
    private readonly config: ConfigType<typeof notificationConfig>,
    @Optional()
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue?: Queue<SendNotificationJob>,
  ) {}

  async dispatch(
    userId: string,
    event: NotificationEvent,
    ctx: TemplateContext = {},
  ): Promise<Notification> {
    const template = buildTemplate(event, ctx);

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title: template.title,
        message: template.message,
        notificationType: template.category,
        data: template.data,
        status: NOTIFICATION_STATUS.PENDING,
      },
    });

    // Realtime is best-effort; never block the caller on it.
    this.realtime.emitNotificationCreated(userId, {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      notificationType: notification.notificationType,
      data: template.data,
      createdAt: notification.createdAt.toISOString(),
    });

    await this.schedulePush(notification.id);
    return notification;
  }

  private async schedulePush(notificationId: string): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add(
          SEND_NOTIFICATION_JOB,
          { notificationId },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        );
        return;
      } catch (error) {
        this.logger.error(
          `Failed to enqueue push job, delivering inline: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }

    // Inline delivery (no Redis/BullMQ). Fire-and-forget with error capture.
    void this.pushDelivery
      .deliver(notificationId)
      .catch((error: unknown) =>
        this.logger.error(
          `Inline push delivery failed: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
  }
}
