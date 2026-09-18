/** A single geographic coordinate (WGS84). */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Input for a route computation. Waypoints are visited in array order. */
export interface ComputeRouteInput {
  origin: LatLng;
  destination: LatLng;
  intermediates?: LatLng[];
  /** Defaults to DRIVE. */
  travelMode?: 'DRIVE' | 'TWO_WHEELER';
  /** Defaults to TRAFFIC_AWARE. */
  routingPreference?: 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE';
}

export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Normalized route result returned to callers. `polyline` is an encoded
 * polyline (Google's algorithm) ready for the mobile map to decode/draw.
 */
export interface ComputedRoute {
  distanceMeters: number;
  distanceKm: number;
  durationSeconds: number;
  durationMin: number;
  polyline: string;
  legs: RouteLeg[];
  bounds: { northeast: LatLng; southwest: LatLng } | null;
  provider: 'google-routes' | 'internal-mock';
  computedAt: string;
}

/**
 * Leg from the driver's live position to the stop they are heading to.
 *
 * Kept apart from the order's own route on purpose: the order route barely ever
 * changes and is cached per order, while this one moves with the driver and is
 * cached by distance travelled. Every field is nullable because a driver with
 * no GPS fix yet is the normal case, not an error.
 */
export interface OrderApproachRoute {
  route: ComputedRoute | null;
  targetStopId: string | null;
  targetStopType: 'PICKUP' | 'DROPOFF' | 'INTERMEDIATE' | null;
  origin: LatLng | null;
  originRecordedAt: string | null;
}
