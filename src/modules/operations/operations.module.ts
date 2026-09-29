import { Module } from '@nestjs/common';
import { DriversModule } from './drivers/drivers.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { AssignmentsModule } from './assignments/assignments.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { MatchingModule } from './matching/matching.module';
import { OffersModule } from './offers/offers.module';
import { PresenceModule } from './presence/presence.module';

@Module({
  imports: [
    PresenceModule,
    DriversModule,
    VehiclesModule,
    AssignmentsModule,
    MatchingModule,
    OffersModule,
    DispatchModule,
  ],
})
export class OperationsModule {}
