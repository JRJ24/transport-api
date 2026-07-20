import { Module } from '@nestjs/common';
import { GoogleRoutesService } from './google-routes.service';

/**
 * Google Maps Platform integration. Exposes only server-side services; the
 * Routes API key is read from configuration and never leaves the backend.
 */
@Module({
  providers: [GoogleRoutesService],
  exports: [GoogleRoutesService],
})
export class GoogleMapsModule {}
