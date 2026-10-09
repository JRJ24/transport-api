import { Module } from '@nestjs/common';
import { EvidenceAccessModule } from '@/modules/support/evidence-access/evidence-access.module';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  // EvidenceAccessModule: la regla de "orden propia" para leer el GPS de una
  // orden es la misma que la de su evidencia.
  imports: [EvidenceAccessModule],
  controllers: [LocationsController],
  providers: [LocationsService],
})
export class LocationsModule {}
