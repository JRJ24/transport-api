import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  // OrdersModule: cancelling a reservation cancels (and settles) its order.
  imports: [OrdersModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
