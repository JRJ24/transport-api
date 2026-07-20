import { BullModule } from '@nestjs/bullmq';
import { Module, type Provider, type DynamicModule } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { notificationConfig } from '@/config';
import { DeviceTokensService } from './device-tokens.service';
import { DevicesController } from './devices.controller';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NOTIFICATIONS_QUEUE } from './notification.queue';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationProcessor } from './processors/notification.processor';
import { PushDeliveryService } from './push-delivery.service';
import { FirebaseAdminService } from './providers/firebase-admin.provider';

// Decide at load time whether to wire the Redis-backed queue. Without it, the
// dispatcher delivers push inline so the app boots with no Redis dependency.
const USE_BULLMQ =
  process.env.NOTIFICATIONS_QUEUE_DRIVER === 'bullmq' ||
  Boolean(process.env.REDIS_URL);

const bullImports: DynamicModule[] = USE_BULLMQ
  ? [
      BullModule.forRootAsync({
        inject: [notificationConfig.KEY],
        useFactory: (config: ConfigType<typeof notificationConfig>) => ({
          connection: {
            host: config.redisHost,
            port: config.redisPort,
            password: config.redisPassword,
            maxRetriesPerRequest: null,
          },
        }),
      }),
      BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
    ]
  : [];

const queueProviders: Provider[] = USE_BULLMQ ? [NotificationProcessor] : [];

@Module({
  imports: [...bullImports],
  controllers: [NotificationsController, DevicesController],
  providers: [
    NotificationsService,
    DeviceTokensService,
    PushDeliveryService,
    NotificationDispatcherService,
    FirebaseAdminService,
    ...queueProviders,
  ],
  exports: [NotificationDispatcherService, DeviceTokensService],
})
export class NotificationsModule {}
