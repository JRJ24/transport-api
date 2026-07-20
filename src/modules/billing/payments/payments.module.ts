import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviderRegistry],
})
export class PaymentsModule {}
