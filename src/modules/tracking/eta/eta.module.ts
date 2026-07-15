import { Module } from '@nestjs/common';
import { EtaController } from './eta.controller';
import { EtaService } from './eta.service';

@Module({
  controllers: [EtaController],
  providers: [EtaService],
})
export class EtaModule {}
