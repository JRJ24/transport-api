import { Module } from '@nestjs/common';
import { AssignmentsModule } from '@/modules/operations/assignments/assignments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AssignmentsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
