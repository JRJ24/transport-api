import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { googleMapsConfig } from './google-maps.config';
import {
  GoogleRoutesError,
  type GoogleRoutesFailure,
} from './errors/google-routes.error';
import type {
  ComputedRoute,
  ComputeRouteInput,
  LatLng,
  RouteLeg,
  RouteMatrixElement,
  RouteMatrixResult,
} from './interfaces/route.interface';
import { haversineMeters } from '@/common/utils/geo.util';

/**
 * Consumes the Google Routes API v2 (`computeRoutes`) server-side only. The API
 * key never leaves the backend. Requests use a `X-Goog-FieldMask` so the
 * provider returns only the fields we need (distance, duration, polyline, legs).
 *
 * When no server key is configured the service degrades gracefully to an
 * internal straight-line estimate so local development and tests work without a
 * live Google account.
 */
@Injectable()
export class GoogleRoutesService {
  private readonly logger = new Logger(GoogleRoutesService.name);

  private static readonly FIELD_MASK = [
    'routes.distanceMeters',
    'routes.duration',
    'routes.polyline.encodedPolyline',
    'routes.legs.distanceMeters',
    'routes.legs.duration',
    'routes.viewport',
  ].join(',');

  private static readonly MATRIX_FIELD_MASK = [
    'originIndex',
    'destinationIndex',
    'status',
    'condition',
    'distanceMeters',
    'duration',
  ].join(',');

  constructor(
    @Inject(googleMapsConfig.KEY)
    private readonly config: ConfigType<typeof googleMapsConfig>,
  ) {}

  /**
   * Mirrors GoogleMapsPlatformService: the offline stub is served only when
   * there is no key at all or the mock flag is explicitly on. A key that is
   * present but rejected must raise, not quietly return a fake straight line.
   */
  get isConfigured(): boolean {
    return !this.config.useMocks && this.config.serverApiKey.length > 0;
  }

  async computeRoute(input: ComputeRouteInput): Promise<ComputedRoute> {
    if (!this.isConfigured) {
      return this.internalMock(input);
    }

    const url = `${this.config.routesBaseUrl}/directions/v2:computeRoutes`;

    try {
      // Built inside the try on purpose: a malformed input would otherwise
      // throw a raw TypeError past the catch-all filter as a bare 500.
      const body = {
        origin: this.toWaypoint(input.origin),
        destination: this.toWaypoint(input.destination),
        intermediates: (input.intermediates ?? []).map((point) =>
          this.toWaypoint(point),
        ),
        travelMode: input.travelMode ?? 'DRIVE',
        routingPreference: input.routingPreference ?? 'TRAFFIC_AWARE',
        polylineEncoding: 'ENCODED_POLYLINE',
      };

      const response = await axios.post(url, body, {
        timeout: this.config.routesTimeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.config.serverApiKey,
          'X-Goog-FieldMask': GoogleRoutesService.FIELD_MASK,
        },
      });

      return this.mapResponse(response.data);
    } catch (error) {
      this.handleProviderError(error);
    }
  }

  /**
   * Driving ETA from many origins to few destinations in one billed call
   * (`computeRouteMatrix`). Used to rank drivers by time to the pickup, which
   * straight-line distance or H3 rings cannot tell.
   *
   * Elements the provider could not route come back with a non-OK status and
   * null figures; a transport failure throws like `computeRoute`.
   */
  async computeRouteMatrix(
    origins: LatLng[],
    destinations: LatLng[],
  ): Promise<RouteMatrixResult> {
    if (origins.length === 0 || destinations.length === 0) {
      return {
        elements: [],
        provider: this.isConfigured ? 'google-routes' : 'internal-mock',
        computedAt: new Date().toISOString(),
      };
    }

    if (!this.isConfigured) {
      return this.internalMatrixMock(origins, destinations);
    }

    const url = `${this.config.routesBaseUrl}/distanceMatrix/v2:computeRouteMatrix`;

    try {
      const body = {
        origins: origins.map((point) => ({
          waypoint: this.toWaypoint(point),
        })),
        destinations: destinations.map((point) => ({
          waypoint: this.toWaypoint(point),
        })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      };

      const response = await axios.post(url, body, {
        timeout: this.config.routesTimeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.config.serverApiKey,
          'X-Goog-FieldMask': GoogleRoutesService.MATRIX_FIELD_MASK,
        },
      });

      return {
        elements: this.mapMatrixResponse(response.data),
        provider: 'google-routes',
        computedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.handleProviderError(error);
    }
  }

  private mapMatrixResponse(data: unknown): RouteMatrixElement[] {
    if (!Array.isArray(data)) {
      throw new GoogleRoutesError('Route provider returned an invalid matrix');
    }

    return data.map((raw) => {
      const element = raw as {
        originIndex?: number;
        destinationIndex?: number;
        status?: { code?: number; message?: string };
        condition?: string;
        distanceMeters?: number;
        duration?: string;
      };
      // An element-level error carries a google.rpc.Status with a non-zero code.
      const failed = Boolean(element.status?.code);
      const routed = element.condition === 'ROUTE_EXISTS';
      const status: RouteMatrixElement['status'] = failed
        ? 'ERROR'
        : routed
          ? 'OK'
          : 'ROUTE_NOT_FOUND';

      return {
        originIndex: element.originIndex ?? 0,
        destinationIndex: element.destinationIndex ?? 0,
        status,
        distanceMeters: status === 'OK' ? (element.distanceMeters ?? 0) : null,
        durationSeconds:
          status === 'OK' ? this.parseDuration(element.duration) : null,
      };
    });
  }

  private toWaypoint(point: LatLng) {
    return {
      location: {
        latLng: { latitude: point.latitude, longitude: point.longitude },
      },
    };
  }

  private mapResponse(data: unknown): ComputedRoute {
    const route = (data as { routes?: unknown[] })?.routes?.[0] as
      | {
          distanceMeters?: number;
          duration?: string;
          polyline?: { encodedPolyline?: string };
          legs?: { distanceMeters?: number; duration?: string }[];
          viewport?: {
            low?: { latitude: number; longitude: number };
            high?: { latitude: number; longitude: number };
          };
        }
      | undefined;

    if (!route || !route.polyline?.encodedPolyline) {
      throw GoogleRoutesError.noRoute();
    }

    const distanceMeters = route.distanceMeters ?? 0;
    const durationSeconds = this.parseDuration(route.duration);
    const legs: RouteLeg[] = (route.legs ?? []).map((leg) => ({
      distanceMeters: leg.distanceMeters ?? 0,
      durationSeconds: this.parseDuration(leg.duration),
    }));

    return {
      distanceMeters,
      distanceKm: Number((distanceMeters / 1000).toFixed(2)),
      durationSeconds,
      durationMin: Math.max(Math.round(durationSeconds / 60), 1),
      polyline: route.polyline.encodedPolyline,
      legs,
      bounds:
        route.viewport?.high && route.viewport?.low
          ? {
              northeast: {
                latitude: route.viewport.high.latitude,
                longitude: route.viewport.high.longitude,
              },
              southwest: {
                latitude: route.viewport.low.latitude,
                longitude: route.viewport.low.longitude,
              },
            }
          : null,
      provider: 'google-routes',
      computedAt: new Date().toISOString(),
    };
  }

  /** Google returns durations as protobuf strings like "540s". */
  private parseDuration(value?: string): number {
    if (!value) {
      return 0;
    }
    const parsed = Number.parseInt(value.replace(/s$/, ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private handleProviderError(error: unknown): never {
    // A GoogleRoutesError raised inside the try (e.g. `noRoute`) must keep its
    // own reason instead of being flattened into a generic provider outage.
    if (error instanceof GoogleRoutesError) {
      throw error;
    }

    if (error instanceof AxiosError) {
      const status = error.response?.status;
      // Log full detail server-side; never leak the API key or raw provider
      // payload to the client. `error.message` from Google carries the billing
      // hint ("You must enable Billing on the Google Cloud Project...").
      this.logger.error(
        `Google Routes request failed: status=${status ?? 'n/a'} code=${error.code ?? 'n/a'} message=${providerMessage(error.response?.data) ?? 'n/a'}`,
      );

      throw new GoogleRoutesError(
        'Route provider is temporarily unavailable',
        status,
        error.response?.data,
        classify(error),
      );
    }

    this.logger.error(
      `Google Routes unexpected error: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    throw new GoogleRoutesError('Route provider is temporarily unavailable');
  }

  // ── Fallback (no server key) ───────────────────────────────────────────────
  private internalMock(input: ComputeRouteInput): ComputedRoute {
    const points = [
      input.origin,
      ...(input.intermediates ?? []),
      input.destination,
    ];
    let distanceMeters = 0;
    const legs: RouteLeg[] = [];

    for (let i = 0; i < points.length - 1; i += 1) {
      const legMeters = this.haversineMeters(points[i], points[i + 1]);
      distanceMeters += legMeters;
      legs.push({
        distanceMeters: Math.round(legMeters),
        durationSeconds: Math.round((legMeters / 1000 / 30) * 3600),
      });
    }

    const durationSeconds = Math.round((distanceMeters / 1000 / 30) * 3600);

    return {
      distanceMeters: Math.round(distanceMeters),
      distanceKm: Number((distanceMeters / 1000).toFixed(2)),
      durationSeconds,
      durationMin: Math.max(Math.round(durationSeconds / 60), 1),
      polyline: this.encodePolyline(points),
      legs,
      bounds: this.boundsOf(points),
      provider: 'internal-mock',
      computedAt: new Date().toISOString(),
    };
  }

  private internalMatrixMock(
    origins: LatLng[],
    destinations: LatLng[],
  ): RouteMatrixResult {
    const elements: RouteMatrixElement[] = [];
    origins.forEach((origin, originIndex) => {
      destinations.forEach((destination, destinationIndex) => {
        const meters = this.haversineMeters(origin, destination);
        elements.push({
          originIndex,
          destinationIndex,
          status: 'OK',
          distanceMeters: Math.round(meters),
          durationSeconds: Math.round((meters / 1000 / 30) * 3600),
        });
      });
    });
    return {
      elements,
      provider: 'internal-mock',
      computedAt: new Date().toISOString(),
    };
  }

  private haversineMeters(a: LatLng, b: LatLng): number {
    return haversineMeters(a, b);
  }

  private boundsOf(points: LatLng[]): ComputedRoute['bounds'] {
    if (points.length === 0) {
      return null;
    }
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    return {
      northeast: { latitude: Math.max(...lats), longitude: Math.max(...lngs) },
      southwest: { latitude: Math.min(...lats), longitude: Math.min(...lngs) },
    };
  }

  /** Encodes coordinates using Google's Encoded Polyline Algorithm Format. */
  private encodePolyline(points: LatLng[]): string {
    let lastLat = 0;
    let lastLng = 0;
    let result = '';

    for (const point of points) {
      const lat = Math.round(point.latitude * 1e5);
      const lng = Math.round(point.longitude * 1e5);
      result += this.encodeValue(lat - lastLat);
      result += this.encodeValue(lng - lastLng);
      lastLat = lat;
      lastLng = lng;
    }

    return result;
  }

  private encodeValue(value: number): string {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let output = '';
    while (v >= 0x20) {
      output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    output += String.fromCharCode(v + 63);
    return output;
  }
}

/**
 * Billing disabled, Routes API not enabled and a restricted key all surface the
 * same way: HTTP 403 with `PERMISSION_DENIED`. They are configuration problems,
 * not transient outages, so they get their own reason.
 */
function classify(error: AxiosError): GoogleRoutesFailure {
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return 'provider-timeout';
  }

  const status = error.response?.status;
  if (status === 401 || status === 403) {
    return 'provider-denied';
  }

  return 'provider-error';
}

/** Google REST errors nest the human-readable reason under `error.message`. */
function providerMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const error = (data as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}
