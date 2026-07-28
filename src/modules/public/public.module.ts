import { Module } from '@nestjs/common';
import { QuoteLeadsModule } from './quote-leads/quote-leads.module';

@Module({
  imports: [QuoteLeadsModule],
})
export class PublicModule {}
