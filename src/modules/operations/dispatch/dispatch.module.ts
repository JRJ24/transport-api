import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { OffersModule } from '../offers/offers.module';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

@Module({
  imports: [MatchingModule, OffersModule],
  controllers: [DispatchController],
  providers: [DispatchService],
})
export class DispatchModule {}
