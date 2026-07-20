import { Module } from '@nestjs/common';
import { GoogleMapsModule } from '@/integrations/google-maps/google-maps.module';
import { OrderRouteService } from './order-route.service';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

@Module({
  imports: [GoogleMapsModule],
  controllers: [RoutesController],
  providers: [RoutesService, OrderRouteService],
  exports: [RoutesService, OrderRouteService],
})
export class RoutesModule {}
