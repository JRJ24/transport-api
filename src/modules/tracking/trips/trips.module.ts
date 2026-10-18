import { Module } from '@nestjs/common';
import { EvidenceAccessModule } from '@/modules/support/evidence-access/evidence-access.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  // EvidenceAccessModule: quien puede leer los viajes de una orden.
  imports: [EvidenceAccessModule],
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}
