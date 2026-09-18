import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OrderStop } from '@generated/prisma/client';
import { STATUS_ORDERS, STOP_TYPE } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { haversineMeters } from '@/common/utils/geo.util';
import { TtlCache } from '@/common/utils/ttl-cache.util';
import { PrismaService } from '@/database/prisma.service';
import { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import type {
  ComputedRoute,
  LatLng,
  OrderApproachRoute,
} from '@/integrations/google-maps/interfaces/route.interface';

/**
 * How far the driver must move before the leg is worth recomputing.
 *
 * Every recomputation is a billed Routes call, and the browser's
 * `watchPosition` fires every few seconds. At 200 m a driver stopped at a
 * traffic light costs nothing, while one actually making progress gets a line
 * that still starts where they are.
 */
const APPROACH_REFRESH_METERS = 200;

/** Traffic changes even when the driver does not, so entries still expire. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

interface CachedApproach {
  origin: LatLng;
  stopId: string;
  route: ComputedRoute;
}

/**
 * The leg between where the driver is and where they are heading.
 *
 * The order's own route (pickup → dropoff) is a separate, far more stable
 * thing served by `OrderRouteService`. Splitting them is what keeps the cost
 * down: the long leg is cached per order for ten minutes, and only this short
 * one follows the driver.
 *
 * The origin is read from the stored `DriverLocation` rather than taken from
 * the caller, so driver, customer and operator all share one cache entry and
 * see the exact same line — and no client can use this as a general-purpose
 * routing proxy.
 */
@Injectable()
export class OrderApproachService {
  private readonly logger = new Logger(OrderApproachService.name);
  private readonly cache = new TtlCache<CachedApproach>(
    CACHE_TTL_MS,
    CACHE_MAX_ENTRIES,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly googleRoutes: GoogleRoutesService,
  ) {}

  async getForOrder(orderId: string): Promise<OrderApproachRoute> {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    const stops = await this.prisma.orderStop.findMany({
      where: { orderId },
      orderBy: { sequence: 'asc' },
    });
    const target = this.targetStop(order.status, stops);
    const location = await this.prisma.driverLocation.findFirst({
      where: { orderId },
      orderBy: { recordedAt: 'desc' },
      select: { latitude: true, longitude: true, recordedAt: true },
    });

    // A driver who has not started GPS yet is the normal case on a fresh
    // assignment, not an error: the map just draws no approach leg.
    if (!target || !location) {
      return {
        route: null,
        targetStopId: target?.id ?? null,
        targetStopType: target?.stopType ?? null,
        origin: null,
        originRecordedAt: null,
      };
    }

    const origin: LatLng = {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    };
    const destination = this.pointOf(target);

    if (!destination) {
      return {
        route: null,
        targetStopId: target.id,
        targetStopType: target.stopType,
        origin,
        originRecordedAt: location.recordedAt.toISOString(),
      };
    }

    return {
      route: await this.routeFor(orderId, origin, destination, target.id),
      targetStopId: target.id,
      targetStopType: target.stopType,
      origin,
      originRecordedAt: location.recordedAt.toISOString(),
    };
  }

  /** Drops the cached leg, e.g. when the order's stops change. */
  invalidate(orderId: string): void {
    this.cache.delete(orderId);
  }

  private async routeFor(
    orderId: string,
    origin: LatLng,
    destination: LatLng,
    stopId: string,
  ): Promise<ComputedRoute | null> {
    const cached = this.cache.get(orderId);
    const reusable =
      cached &&
      cached.stopId === stopId &&
      haversineMeters(cached.origin, origin) <= APPROACH_REFRESH_METERS;

    if (reusable) {
      return cached.route;
    }

    try {
      const route = await this.googleRoutes.computeRoute({
        origin,
        destination,
      });
      this.cache.set(orderId, { origin, stopId, route });
      return route;
    } catch (error) {
      // The approach leg is an extra on top of a map that already works. A
      // provider outage must not take the whole screen down with it.
      this.logger.warn(
        `Approach leg unavailable for order ${orderId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  /**
   * Where the driver is heading right now.
   *
   * `completedAt` is the honest signal and wins when it is there, but nothing
   * writes it today, so the fallback is the order status: until the trip starts
   * the driver is going to pick up, and after that to deliver. The driver apps
   * apply this same rule for the «Cómo llegar» button.
   */
  private targetStop(
    status: STATUS_ORDERS,
    stops: OrderStop[],
  ): OrderStop | null {
    if (stops.length === 0) {
      return null;
    }

    const pending = stops.filter((stop) => !stop.completedAt);
    const pool = pending.length > 0 ? pending : stops;
    const alreadyPickedUp =
      status === STATUS_ORDERS.IN_PROGRESS ||
      status === STATUS_ORDERS.DELIVERED;

    if (alreadyPickedUp) {
      return (
        pool.find((stop) => stop.stopType === STOP_TYPE.DROPOFF) ??
        pool[pool.length - 1] ??
        null
      );
    }

    return (
      pool.find((stop) => stop.stopType === STOP_TYPE.PICKUP) ?? pool[0] ?? null
    );
  }

  private pointOf(stop: OrderStop): LatLng | null {
    if (stop.latitude === null || stop.longitude === null) {
      return null;
    }

    const latitude = Number(stop.latitude);
    const longitude = Number(stop.longitude);

    return Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null;
  }
}
