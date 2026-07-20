import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_STATUS } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import { DeviceTokensService } from './device-tokens.service';
import { FirebaseAdminService } from './providers/firebase-admin.provider';

/**
 * Performs the actual FCM delivery for a persisted notification. Shared by the
 * BullMQ processor and the inline dispatcher so behaviour is identical.
 */
@Injectable()
export class PushDeliveryService {
  private readonly logger = new Logger(PushDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceTokens: DeviceTokensService,
    private readonly firebase: FirebaseAdminService,
  ) {}

  async deliver(notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      this.logger.warn(`Notification ${notificationId} not found for delivery`);
      return;
    }

    const tokens = await this.deviceTokens.listActive(notification.userId);

    if (!this.firebase.enabled || tokens.length === 0) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: NOTIFICATION_STATUS.SKIPPED },
      });
      return;
    }

    const data = this.stringifyData(notification.data);

    try {
      const result = await this.firebase.sendToTokens(
        tokens.map((t) => t.token),
        { title: notification.title, body: notification.message, data },
      );

      await this.deviceTokens.deactivateInvalid(result.invalidTokens);

      const status =
        result.successCount === 0
          ? NOTIFICATION_STATUS.FAILED
          : result.failureCount > 0
            ? NOTIFICATION_STATUS.PARTIAL
            : NOTIFICATION_STATUS.SENT;

      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status,
          sentAt: new Date(),
          failureReason:
            status === NOTIFICATION_STATUS.SENT
              ? null
              : `success=${result.successCount} failure=${result.failureCount}`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(
        `Push delivery failed for ${notificationId}: ${message}`,
      );
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: NOTIFICATION_STATUS.FAILED, failureReason: message },
      });
      throw error;
    }
  }

  /** FCM data values must be strings. */
  private stringifyData(data: unknown): Record<string, string> {
    if (!data || typeof data !== 'object') {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (value === null || value === undefined) {
        continue;
      }
      out[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return out;
  }
}
