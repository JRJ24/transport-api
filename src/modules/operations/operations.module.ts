import { Module } from '@nestjs/common';
import { DriversModule } from './drivers/drivers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { DispatchModule } from './dispatch/dispatch.module';

@Module({
  imports: [DriversModule, VehiclesModule, AssignmentsModule, DispatchModule],
})
export class OperationsModule {}
