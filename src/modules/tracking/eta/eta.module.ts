import { Module } from '@nestjs/common';
import { EvidenceAccessModule } from '@/modules/support/evidence-access/evidence-access.module';
import { EtaController } from './eta.controller';
import { EtaService } from './eta.service';

@Module({
  // EvidenceAccessModule: quien puede ver el ETA de una orden.
  imports: [EvidenceAccessModule],
  controllers: [EtaController],
  providers: [EtaService],
})
export class EtaModule {}
