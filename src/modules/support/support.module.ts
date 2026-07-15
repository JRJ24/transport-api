import { Module } from '@nestjs/common';
import { DeliveryProofsModule } from './delivery-proofs/delivery-proofs.module';
import { IncidentsModule } from './incidents/incidents.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    DeliveryProofsModule,
    IncidentsModule,
    AttachmentsModule,
    NotificationsModule,
  ],
})
export class SupportModule {}
