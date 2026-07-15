import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { ReservationsModule } from './reservations/reservations.module';
import { PricingModule } from './pricing/pricing.module';
import { RoutesModule } from './routes/routes.module';
import { VehicleCategoriesModule } from './vehicle-categories/vehicle-categories.module';

@Module({
  imports: [
    OrdersModule,
    ReservationsModule,
    PricingModule,
    RoutesModule,
    VehicleCategoriesModule,
  ],
})
export class TransportModule {}
