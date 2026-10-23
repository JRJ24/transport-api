import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';
import { TtlCache } from '@/common/utils/ttl-cache.util';
import { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import type {
  ComputedRoute,
  LatLng,
} from '@/integrations/google-maps/interfaces/route.interface';

/**
 * Computes and caches the driving route for an order based on its stops. The
 * route is computed once and reused while valid (TTL) so we never call the
 * Routes API for every GPS ping.
 */
@Injectable()
export class OrderRouteService {
  private static readonly TTL_MS = 10 * 60 * 1000;
  private readonly cache = new TtlCache<ComputedRoute>(
    OrderRouteService.TTL_MS,
    500,
  );

  private readonly invalidCoordinatesCache = new TtlCache<true>(
    2 * 60 * 1000,
    500,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleRoutes: GoogleRoutesService,
  ) {}

  async getForOrder(
    orderId: string,
    forceRefresh = false,
  ): Promise<ComputedRoute> {
    if (!forceRefresh) {
      if (this.invalidCoordinatesCache.get(orderId)) {
        throw this.invalidCoordinatesError();
      }
      const cached = this.cache.get(orderId);
      if (cached) {
        return cached;
      }
    }

    const stops = await this.prisma.orderStop.findMany({
      where: { orderId },
      orderBy: { sequence: 'asc' },
    });

    if (stops.length < 2) {
      throw new NotFoundException(
        'Order does not have enough stops to compute a route',
      );
    }

    const points: LatLng[] = [];
    for (const stop of stops) {
      const latitude = stop.latitude === null ? NaN : Number(stop.latitude);
      const longitude = stop.longitude === null ? NaN : Number(stop.longitude);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        // Never omit a required stop or reuse an old route after a refresh
        // discovers that its coordinates are incomplete.
        this.cache.delete(orderId);
        this.invalidCoordinatesCache.set(orderId, true);
        throw this.invalidCoordinatesError();
      }
      points.push({ latitude, longitude });
    }
    // A corrected order must not retain its old coordinate rejection if
    // the provider fails while computing the new route.
    this.invalidCoordinatesCache.delete(orderId);

    const route = await this.googleRoutes.computeRoute({
      origin: points[0],
      destination: points[points.length - 1],
      intermediates: points.slice(1, -1),
    });

    this.invalidCoordinatesCache.delete(orderId);
    this.cache.set(orderId, route);

    return route;
  }

  invalidate(orderId: string): void {
    this.cache.delete(orderId);
    this.invalidCoordinatesCache.delete(orderId);
  }

  private invalidCoordinatesError(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: ERROR_CODES.ROUTE_NOT_FOUND,
      message: 'Order stops require valid coordinates to compute a route',
    });
  }
}
