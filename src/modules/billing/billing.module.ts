import { Module } from '@nestjs/common';
import { PaymentsModule } from './payments/payments.module';
import { RefundsModule } from './refunds/refunds.module';
import { CancellationFeesModule } from './cancellation-fees/cancellation-fees.module';
import { TransactionsModule } from './transactions/transactions.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    PaymentsModule,
    RefundsModule,
    CancellationFeesModule,
    TransactionsModule,
    WebhooksModule,
  ],
})
export class BillingModule {}
