import { Module } from '@nestjs/common';
import { DemandService } from './demand.service';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  controllers: [PricingController],
  providers: [PricingService, DemandService],
  exports: [PricingService, DemandService],
})
export class PricingModule {}
