import { Module } from '@nestjs/common';
import { EvidenceAccessService } from './evidence-access.service';

@Module({
  providers: [EvidenceAccessService],
  exports: [EvidenceAccessService],
})
export class EvidenceAccessModule {}
