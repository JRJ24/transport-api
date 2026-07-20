import { Module } from '@nestjs/common';
import { LocationsModule } from './locations/locations.module';
import { TripsModule } from './trips/trips.module';
import { OrderEventsModule } from './order-events/order-events.module';
import { EtaModule } from './eta/eta.module';
import { TrackingSessionsModule } from './sessions/tracking-sessions.module';

@Module({
  imports: [
    LocationsModule,
    TripsModule,
    OrderEventsModule,
    EtaModule,
    TrackingSessionsModule,
  ],
})
export class TrackingModule {}
