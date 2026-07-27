import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CardnetGateway } from './cardnet.gateway';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentProviderRegistry, CardnetGateway],
})
export class PaymentsModule {}
