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
  routesTimeoutMs: Number(process.env.GOOGLE_ROUTES_TIMEOUT_MS ?? 10_000),
}));
