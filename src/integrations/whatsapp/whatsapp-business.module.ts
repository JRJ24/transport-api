import { Module } from '@nestjs/common';
import { WhatsAppBusinessService } from './whatsapp-business.service';

@Module({
  providers: [WhatsAppBusinessService],
  exports: [WhatsAppBusinessService],
})
export class WhatsAppBusinessModule {}
