import { Module } from '@nestjs/common';
import { EvidenceAccessModule } from '@/modules/support/evidence-access/evidence-access.module';
import { OrderEventsController } from './order-events.controller';
import { OrderEventsService } from './order-events.service';

@Module({
  // EvidenceAccessModule: quien lee o escribe la bitacora de una orden.
  imports: [EvidenceAccessModule],
  controllers: [OrderEventsController],
  providers: [OrderEventsService],
})
export class OrderEventsModule {}
