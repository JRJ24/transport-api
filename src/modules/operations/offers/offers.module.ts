import { BullModule } from '@nestjs/bullmq';
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { NotificationsModule } from '@/modules/support/notifications/notifications.module';
import { AssignmentsModule } from '../assignments/assignments.module';
import { MatchingModule } from '../matching/matching.module';
import { OfferProcessor } from './offer.processor';
import { MATCHING_QUEUE, MATCHING_QUEUE_ENABLED } from './offer.queue';
import { OfferSchedulerService } from './offer-scheduler.service';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

// BullModule.forRoot is registered by NotificationsModule whenever REDIS_URL
// is set, so this queue shares that connection.
const queueImports: DynamicModule[] = MATCHING_QUEUE_ENABLED
  ? [BullModule.registerQueue({ name: MATCHING_QUEUE })]
  : [];
const queueProviders: Provider[] = MATCHING_QUEUE_ENABLED
  ? [OfferProcessor]
  : [];

@Module({
  imports: [
    NotificationsModule,
    AssignmentsModule,
    MatchingModule,
    ...queueImports,
  ],
  controllers: [OffersController],
  providers: [OffersService, OfferSchedulerService, ...queueProviders],
  exports: [OffersService],
})
export class OffersModule {}
