import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/support/notifications/notifications.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CardnetGateway } from './cardnet.gateway';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

@Module({
  // NotificationsModule: staff is alerted when a capture needs a refund.
  imports: [NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviderRegistry, CardnetGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
