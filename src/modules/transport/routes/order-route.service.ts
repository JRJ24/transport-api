import { Injectable, NotFoundException } from '@nestjs/common';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleRoutes: GoogleRoutesService,
  ) {}

  async getForOrder(
    orderId: string,
    forceRefresh = false,
  ): Promise<ComputedRoute> {
    if (!forceRefresh) {
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

    const points: LatLng[] = stops.map((stop) => ({
      latitude: Number(stop.latitude),
      longitude: Number(stop.longitude),
    }));

    const route = await this.googleRoutes.computeRoute({
      origin: points[0],
      destination: points[points.length - 1],
      intermediates: points.slice(1, -1),
    });

    this.cache.set(orderId, route);

    return route;
  }

  invalidate(orderId: string): void {
    this.cache.delete(orderId);
  }
}
