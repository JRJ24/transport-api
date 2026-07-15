import { Module } from '@nestjs/common';
import { ParametersController } from './parameters.controller';
import { ParametersService } from './parameters.service';

@Module({
  controllers: [ParametersController],
  providers: [ParametersService],
})
export class ParametersModule {}
