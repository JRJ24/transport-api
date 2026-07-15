import { Module } from '@nestjs/common';
import { CancellationFeesController } from './cancellation-fees.controller';
import { CancellationFeesService } from './cancellation-fees.service';

@Module({
  controllers: [CancellationFeesController],
  providers: [CancellationFeesService],
})
export class CancellationFeesModule {}
