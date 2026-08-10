import { Module } from '@nestjs/common';
import { AssignmentsModule } from '../assignments/assignments.module';
import { DispatchController } from './dispatch.controller';
import { DispatchService } from './dispatch.service';

@Module({
  imports: [AssignmentsModule],
  controllers: [DispatchController],
  providers: [DispatchService],
})
export class DispatchModule {}
