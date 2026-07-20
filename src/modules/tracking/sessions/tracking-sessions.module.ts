import { Module } from '@nestjs/common';
import { TrackingSessionsController } from './tracking-sessions.controller';
import { TrackingSessionsService } from './tracking-sessions.service';

@Module({
  controllers: [TrackingSessionsController],
  providers: [TrackingSessionsService],
  exports: [TrackingSessionsService],
})
export class TrackingSessionsModule {}
