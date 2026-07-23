import { Module } from '@nestjs/common';
import { GoogleMapsController } from './google-maps.controller';
import { GoogleMapsPlatformService } from './google-maps-platform.service';
import { GoogleRoutesService } from './google-routes.service';

/**
 * Google Maps Platform integration. Exposes only server-side services; the
 * Routes API key is read from configuration and never leaves the backend.
 */
@Module({
  controllers: [GoogleMapsController],
  providers: [GoogleRoutesService, GoogleMapsPlatformService],
  exports: [GoogleRoutesService, GoogleMapsPlatformService],
})
export class GoogleMapsModule {}
