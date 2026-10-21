import { Module } from '@nestjs/common';
import { RoutesModule } from '../routes/routes.module';
import { DemandService } from './demand.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  // RoutesModule: the quote measures the route itself instead of trusting
  // the distance the client sends.
  imports: [RoutesModule],
  controllers: [PricingController],
  providers: [PricingService, DemandService],
  exports: [PricingService, DemandService],
})
export class PricingModule {}
