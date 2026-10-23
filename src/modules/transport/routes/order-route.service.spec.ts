import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '@/database/prisma.service';
import type { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import type { ComputedRoute } from '@/integrations/google-maps/interfaces/route.interface';
import { OrderRouteService } from './order-route.service';

const TTL_MS = 10 * 60 * 1000;
const route: ComputedRoute = {
  distanceMeters: 4200,
  distanceKm: 4.2,
  durationSeconds: 540,
  durationMin: 9,
  polyline: 'encoded-route',
  legs: [],
  bounds: null,
  provider: 'google-routes',
  computedAt: '2026-10-23T12:00:00.000Z',
};

function setup() {
  const findMany = jest.fn().mockResolvedValue([
    { latitude: '18.48', longitude: '-69.93' },
    { latitude: '18.49', longitude: '-69.92' },
    { latitude: '18.50', longitude: '-69.91' },
  ]);
  const computeRoute = jest.fn().mockResolvedValue(route);
  const service = new OrderRouteService(
    { orderStop: { findMany } } as unknown as PrismaService,
    { computeRoute } as unknown as GoogleRoutesService,
  );
  return { service, findMany, computeRoute };
}

async function fill(service: OrderRouteService) {
  for (let i = 1; i <= 500; i++) {
    await service.getForOrder(`order-${i}`);
  }
}

describe('OrderRouteService bounded cache (REN-API-009)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  describe('US1: bounded route storage', () => {
    it('evicts the oldest route after 500 distinct orders and keeps recent ones', async () => {
      const { service, computeRoute } = setup();
      await fill(service);
      expect(computeRoute).toHaveBeenCalledTimes(500);

      // The first entry still fits at exactly 500. Reading it is not a
      // refresh: capacity eviction uses storage order rather than LRU.
      await service.getForOrder('order-1');
      expect(computeRoute).toHaveBeenCalledTimes(500);
      await service.getForOrder('order-501');
      await service.getForOrder('order-2');
      await service.getForOrder('order-501');
      expect(computeRoute).toHaveBeenCalledTimes(501);

      await service.getForOrder('order-1');
      expect(computeRoute).toHaveBeenCalledTimes(502);
    });

    it('keeps a refreshed route and evicts the next oldest when capacity is full', async () => {
      const { service, computeRoute } = setup();
      await fill(service);
      await service.getForOrder('order-1', true);
      expect(computeRoute).toHaveBeenCalledTimes(501);

      // Refreshing a key does not consume an extra slot.
      await service.getForOrder('order-2');
      expect(computeRoute).toHaveBeenCalledTimes(501);
      await service.getForOrder('order-501');
      await service.getForOrder('order-1');
      expect(computeRoute).toHaveBeenCalledTimes(502);
      await service.getForOrder('order-2');
      expect(computeRoute).toHaveBeenCalledTimes(503);
    });
  });

  describe('US2: route contract and refresh controls', () => {
    it('reuses a valid route without reading stops or calling Google again', async () => {
      const { service, computeRoute, findMany } = setup();
      expect(await service.getForOrder('order-1')).toEqual(route);
      jest.setSystemTime(Date.now() + TTL_MS - 1);
      expect(await service.getForOrder('order-1')).toEqual(route);
      expect(computeRoute).toHaveBeenCalledTimes(1);
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('recomputes at exactly ten minutes', async () => {
      const { service, computeRoute } = setup();
      await service.getForOrder('order-1');
      jest.setSystemTime(Date.now() + TTL_MS);
      const fresh = { ...route, polyline: 'fresh-route' };
      computeRoute.mockResolvedValueOnce(fresh);
      expect(await service.getForOrder('order-1')).toEqual(fresh);
      expect(await service.getForOrder('order-1')).toEqual(fresh);
      expect(computeRoute).toHaveBeenCalledTimes(2);
    });

    it('forceRefresh replaces a valid route', async () => {
      const { service, computeRoute } = setup();
      await service.getForOrder('order-1');
      const fresh = { ...route, polyline: 'forced-route' };
      computeRoute.mockResolvedValueOnce(fresh);
      expect(await service.getForOrder('order-1', true)).toEqual(fresh);
      expect(await service.getForOrder('order-1')).toEqual(fresh);
      expect(computeRoute).toHaveBeenCalledTimes(2);
    });

    it('invalidates only the specified order', async () => {
      const { service, computeRoute } = setup();
      await service.getForOrder('order-1');
      await service.getForOrder('order-2');
      service.invalidate('order-1');
      await service.getForOrder('order-2');
      expect(computeRoute).toHaveBeenCalledTimes(2);
      await service.getForOrder('order-1');
      expect(computeRoute).toHaveBeenCalledTimes(3);
    });

    it('keeps the ordered stops, coordinate conversion and route response', async () => {
      const { service, computeRoute, findMany } = setup();
      expect(await service.getForOrder('order-1')).toEqual(route);
      expect(findMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        orderBy: { sequence: 'asc' },
      });
      expect(computeRoute).toHaveBeenCalledWith({
        origin: { latitude: 18.48, longitude: -69.93 },
        destination: { latitude: 18.5, longitude: -69.91 },
        intermediates: [{ latitude: 18.49, longitude: -69.92 }],
      });
    });

    it.each([0, 1])(
      'preserves 404 for %i stops without calling Google',
      async (count) => {
        const { service, computeRoute, findMany } = setup();
        findMany.mockResolvedValueOnce(
          Array.from({ length: count }, () => ({
            latitude: 18.48,
            longitude: -69.93,
          })),
        );
        await expect(service.getForOrder('order-1')).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(computeRoute).not.toHaveBeenCalled();
      },
    );

    it('does not cache a failed calculation and retries the next request', async () => {
      const { service, computeRoute } = setup();
      const error = new Error('provider unavailable');
      computeRoute.mockRejectedValueOnce(error);
      await expect(service.getForOrder('order-1')).rejects.toBe(error);
      expect(await service.getForOrder('order-1')).toEqual(route);
      expect(await service.getForOrder('order-1')).toEqual(route);
      expect(computeRoute).toHaveBeenCalledTimes(2);
    });
  });
});
