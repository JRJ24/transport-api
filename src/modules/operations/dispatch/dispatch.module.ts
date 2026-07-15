import { Module } from '@nestjs/common';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

@Module({
  controllers: [DispatchController],
  providers: [DispatchService],
})
export class DispatchModule {}
