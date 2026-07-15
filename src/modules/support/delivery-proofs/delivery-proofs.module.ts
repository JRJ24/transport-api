import { Module } from '@nestjs/common';
import { DeliveryProofsController } from './delivery-proofs.controller';
import { DeliveryProofsService } from './delivery-proofs.service';

@Module({
  controllers: [DeliveryProofsController],
  providers: [DeliveryProofsService],
})
export class DeliveryProofsModule {}
