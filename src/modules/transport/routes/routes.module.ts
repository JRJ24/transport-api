import { Module } from '@nestjs/common';
import { GoogleMapsModule } from '@/integrations/google-maps/google-maps.module';
import { EvidenceAccessModule } from '@/modules/support/evidence-access/evidence-access.module';
import { OrderApproachService } from './order-approach.service';
import { OrderRouteService } from './order-route.service';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

@Module({
  // EvidenceAccessModule: quien puede ver la ruta y la aproximacion de una
  // orden (la misma regla que su evidencia).
  imports: [GoogleMapsModule, EvidenceAccessModule],
  controllers: [RoutesController],
  providers: [RoutesService, OrderRouteService, OrderApproachService],
  exports: [RoutesService, OrderRouteService, OrderApproachService],
})
export class RoutesModule {}
