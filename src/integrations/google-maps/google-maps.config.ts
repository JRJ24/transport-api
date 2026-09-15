import { registerAs } from '@nestjs/config';

/**
 * Server-side Google Maps Platform configuration. The Routes API key lives ONLY
 * on the backend and is never shipped to the mobile client. We accept the legacy
 * `GOOGLE_MAPS_API_KEY` as a fallback so existing environments keep working.
 */
export const googleMapsConfig = registerAs('googleMaps', () => ({
  serverApiKey:
    process.env.GOOGLE_MAPS_SERVER_API_KEY ??
    process.env.GOOGLE_MAPS_API_KEY ??
    '',
  routesBaseUrl:
    process.env.GOOGLE_ROUTES_API_BASE_URL ?? 'https://routes.googleapis.com',
  placesBaseUrl:
    process.env.GOOGLE_PLACES_API_BASE_URL ??
    'https://places.googleapis.com/v1',
  geocodingBaseUrl:
    process.env.GOOGLE_GEOCODING_API_BASE_URL ??
    'https://maps.googleapis.com/maps/api/geocode/json',
  addressValidationBaseUrl:
    process.env.GOOGLE_ADDRESS_VALIDATION_API_BASE_URL ??
    'https://addressvalidation.googleapis.com/v1:validateAddress',
  roadsBaseUrl:
    process.env.GOOGLE_ROADS_API_BASE_URL ?? 'https://roads.googleapis.com/v1',
  routeOptimizationBaseUrl:
    process.env.GOOGLE_ROUTE_OPTIMIZATION_API_BASE_URL ??
    'https://routeoptimization.googleapis.com',
  routeOptimizationProjectId:
    process.env.GOOGLE_ROUTE_OPTIMIZATION_PROJECT_ID ?? '',
  routesTimeoutMs: Number(process.env.GOOGLE_ROUTES_TIMEOUT_MS ?? 10_000),
  mapsTimeoutMs: Number(process.env.GOOGLE_MAPS_TIMEOUT_MS ?? 10_000),
  /**
   * Opt in to the offline stubs explicitly. A key that is present but dead
   * (billing off, API not enabled) must raise a typed error, never silently
   * serve fake Santo Domingo coordinates - that is what made the geocoding
   * failure invisible in the first place.
   */
  useMocks: process.env.GOOGLE_MAPS_USE_MOCKS === 'true',
  /**
   * Which distance feeds the price: 'road' uses the real driving distance from
   * the Routes API, 'straight-line' keeps the legacy haversine figure.
   */
  pricingDistance: (process.env.ROUTE_PRICING_DISTANCE ?? 'road') as
    'road' | 'straight-line',
}));
