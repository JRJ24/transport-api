import { Module } from '@nestjs/common';
import { OrderEventsController } from './order-events.controller';
import { OrderEventsService } from './order-events.service';

@Module({
  controllers: [OrderEventsController],
  providers: [OrderEventsService],
})
export class OrderEventsModule {}
