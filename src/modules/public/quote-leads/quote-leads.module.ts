import { Module } from '@nestjs/common';
import { WhatsAppBusinessModule } from '@/integrations/whatsapp/whatsapp-business.module';
import { QuoteLeadsController } from './quote-leads.controller';
import { QuoteLeadsService } from './quote-leads.service';

@Module({
  imports: [WhatsAppBusinessModule],
  controllers: [QuoteLeadsController],
  providers: [QuoteLeadsService],
})
export class QuoteLeadsModule {}
