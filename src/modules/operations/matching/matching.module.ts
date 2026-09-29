import { Module } from '@nestjs/common';
import { GoogleMapsModule } from '@/integrations/google-maps/google-maps.module';
import { MatchingService } from './matching.service';

@Module({
  imports: [GoogleMapsModule],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
