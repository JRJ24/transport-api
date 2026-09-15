import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { TtlCache, roundCoord } from '@/common/utils/ttl-cache.util';
import { GoogleRoutesError } from '@/integrations/google-maps/errors/google-routes.error';
import { googleMapsConfig } from '@/integrations/google-maps/google-maps.config';
import { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import type { LatLng } from '@/integrations/google-maps/interfaces/route.interface';
import type { EstimateRouteDto } from './dto/estimate-route.dto';

export interface RouteEstimateResult {
  originAddress: string;
  destinationAddress: string;

  /**
   * The number the price is built from. Which one it is depends on
   * `ROUTE_PRICING_DISTANCE`; `distanceSource` always says which one applied.
   */
  distanceKm: number;
  estimatedDurationMin: number;

  /** Always present: the haversine distance between the two stops. */
  straightLineDistanceKm: number;
  /** Real driving figures. Null when the provider could not be reached. */
  roadDistanceKm: number | null;
  roadDurationMin: number | null;

  /** Encoded polyline of the real route, for the map to draw. */
  polyline: string | null;
  bounds: { northeast: LatLng; southwest: LatLng } | null;

  provider: 'google-routes' | 'internal-mock';
  distanceSource: 'road' | 'straight-line';
  computedAt: string;
}

/** Google bills every call, and the order form recomputes on every pin move. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);
  private readonly cache = new TtlCache<RouteEstimateResult>(
    CACHE_TTL_MS,
    CACHE_MAX_ENTRIES,
  );

  constructor(
    private readonly googleRoutes: GoogleRoutesService,
    @Inject(googleMapsConfig.KEY)
    private readonly config: ConfigType<typeof googleMapsConfig>,
  ) {}

  /**
   * Distance, duration and drawable route between two stops.
   *
   * This is the single source of truth for the customer portal: the same
   * numbers feed the map, the quote shown in the form and the quote the order
   * is created with. Keeping it one endpoint is what stops the displayed price
   * and the charged price from drifting apart.
   *
   * It degrades instead of failing: if the Routes API is unreachable the caller
   * still gets a usable straight-line estimate, flagged as such in
   * `provider`/`distanceSource`, so a customer can always place an order.
   */
  async estimate(dto: EstimateRouteDto): Promise<RouteEstimateResult> {
    const straightLineDistanceKm = this.haversineKm(
      dto.originLatitude,
      dto.originLongitude,
      dto.destinationLatitude,
      dto.destinationLongitude,
    );

    const cacheKey = this.cacheKey(dto);
    const cached = this.cache.get(cacheKey);

    if (cached) {
      // Addresses only echo back, so they are not part of the key.
      return {
        ...cached,
        originAddress: dto.originAddress,
        destinationAddress: dto.destinationAddress,
      };
    }

    const route = await this.computeRouteOrNull(dto);

    const roadDistanceKm = route?.distanceKm ?? null;
    const roadDurationMin = route?.durationMin ?? null;
    const useRoad =
      this.config.pricingDistance === 'road' && roadDistanceKm !== null;

    const result: RouteEstimateResult = {
      originAddress: dto.originAddress,
      destinationAddress: dto.destinationAddress,
      distanceKm: useRoad ? roadDistanceKm : straightLineDistanceKm,
      estimatedDurationMin:
        roadDurationMin ?? this.straightLineDurationMin(straightLineDistanceKm),
      straightLineDistanceKm,
      roadDistanceKm,
      roadDurationMin,
      polyline: route?.polyline ?? null,
      bounds: route?.bounds ?? null,
      provider: route?.provider ?? 'internal-mock',
      distanceSource: useRoad ? 'road' : 'straight-line',
      computedAt: new Date().toISOString(),
    };

    // Only successes are cached. Pinning a provider outage for five minutes
    // would keep the app broken after the configuration is already fixed.
    if (route) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * The one place a `GoogleRoutesError` is swallowed rather than surfaced.
   *
   * Everywhere else it becomes a 503 through `GoogleRoutesExceptionFilter`, but
   * here a provider outage must not block a customer from ordering.
   */
  private async computeRouteOrNull(dto: EstimateRouteDto) {
    try {
      return await this.googleRoutes.computeRoute({
        origin: {
          latitude: dto.originLatitude,
          longitude: dto.originLongitude,
        },
        destination: {
          latitude: dto.destinationLatitude,
          longitude: dto.destinationLongitude,
        },
      });
    } catch (error) {
      if (!(error instanceof GoogleRoutesError)) {
        throw error;
      }

      this.logger.warn(
        `Route estimate falling back to a straight line: reason=${error.reason}`,
      );
      return null;
    }
  }

  private cacheKey(dto: EstimateRouteDto): string {
    return [
      roundCoord(dto.originLatitude),
      roundCoord(dto.originLongitude),
      roundCoord(dto.destinationLatitude),
      roundCoord(dto.destinationLongitude),
      this.config.pricingDistance,
    ].join('|');
  }

  /** Legacy fallback speed: 30 km/h average across Santo Domingo traffic. */
  private straightLineDurationMin(distanceKm: number): number {
    return Math.max(Math.round((distanceKm / 30) * 60), 1);
  }

  private haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const earthRadiusKm = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return Number(
      (earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(
        2,
      ),
    );
  }

  private toRad(value: number): number {
    return (value * Math.PI) / 180;
  }
}
