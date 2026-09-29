import { Global, Module } from '@nestjs/common';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

/**
 * Global because presence is written from the socket gateway, the drivers
 * module (status changes) and assignments, and read by matching and demand.
 */
@Global()
@Module({
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
