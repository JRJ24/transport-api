import { Module } from '@nestjs/common';
import { EvidenceAccessModule } from '../evidence-access/evidence-access.module';
import { DeliveryProofsController } from './delivery-proofs.controller';
import { DeliveryProofsService } from './delivery-proofs.service';

@Module({
  imports: [EvidenceAccessModule],
  controllers: [DeliveryProofsController],
  providers: [DeliveryProofsService],
})
export class DeliveryProofsModule {}
