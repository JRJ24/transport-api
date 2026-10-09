import { Module } from '@nestjs/common';
import { EvidenceAccessModule } from '@/modules/support/evidence-access/evidence-access.module';
import { CancellationFeesController } from './cancellation-fees.controller';
import { CancellationFeesService } from './cancellation-fees.service';

@Module({
  // EvidenceAccessModule: solo staff o el cliente dueno ven el cargo de una
  // orden.
  imports: [EvidenceAccessModule],
  controllers: [CancellationFeesController],
  providers: [CancellationFeesService],
})
export class CancellationFeesModule {}
