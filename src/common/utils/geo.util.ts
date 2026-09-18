import type { LatLng } from '@/integrations/google-maps/interfaces/route.interface';

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Great-circle distance between two coordinates, in metres.
 *
 * `RoutesService.haversineKm` and `GoogleRoutesService.haversineMeters` are the
 * same formula kept private to their own fallbacks. This copy exists because
 * `OrderApproachService` needs the distance as a *decision* — whether the driver
 * moved far enough to be worth another billed Routes call — not as a fallback
 * estimate.
 */
export function haversineMeters(from: LatLng, to: LatLng): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRad(to.latitude - from.latitude);
  const deltaLng = toRad(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) *
      Math.cos(toRad(to.latitude)) *
      Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}
