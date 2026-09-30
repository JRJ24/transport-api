import { Global, Module } from '@nestjs/common';
import { RuntimeSettingsService } from './runtime-settings.service';
import { SettingsController } from './settings.controller';
import { SystemStatusService } from './system-status.service';

/** Global: dispatch, pricing and realtime read runtime settings. */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [RuntimeSettingsService, SystemStatusService],
  exports: [RuntimeSettingsService],
})
export class SettingsModule {}
