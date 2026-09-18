import { NotFoundException } from '@nestjs/common';
import { OrderApproachService } from './order-approach.service';
import type { PrismaService } from '@/database/prisma.service';
import type { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import type { ComputedRoute } from '@/integrations/google-maps/interfaces/route.interface';

const SANTO_DOMINGO = { latitude: 18.4861, longitude: -69.9312 };
/** ~55 m north of the origin: inside the 200 m threshold. */
const NEARBY = { latitude: 18.4866, longitude: -69.9312 };
/** ~1.1 km north: well past it. */
const FAR = { latitude: 18.4961, longitude: -69.9312 };

const route = {
  distanceMeters: 4200,
  distanceKm: 4.2,
  durationSeconds: 540,
  durationMin: 9,
  polyline: 'abc',
  legs: [],
  bounds: null,
  provider: 'google-routes',
  computedAt: '2026-09-18T12:00:00.000Z',
} as ComputedRoute;

const stop = (id: string, stopType: string, sequence: number) => ({
  id,
  stopType,
  sequence,
  latitude: 18.47,
  longitude: -69.9,
  completedAt: null,
});

const PICKUP = stop('pickup-1', 'PICKUP', 1);
const DROPOFF = stop('dropoff-1', 'DROPOFF', 2);

function build({
  status = 'ACCEPTED',
  stops = [PICKUP, DROPOFF],
  location = { ...SANTO_DOMINGO, recordedAt: new Date('2026-09-18T12:00:00Z') },
  computeRoute = jest.fn().mockResolvedValue(route),
}: {
  status?: string;
  stops?: unknown[];
  location?: unknown;
  computeRoute?: jest.Mock;
} = {}) {
  const findFirst = jest.fn().mockResolvedValue(location);
  const prisma = {
    transportOrder: {
      findUnique: jest.fn().mockResolvedValue(status ? { status } : null),
    },
    orderStop: { findMany: jest.fn().mockResolvedValue(stops) },
    driverLocation: { findFirst },
  };
  const service = new OrderApproachService(
    prisma as unknown as PrismaService,
    { computeRoute } as unknown as GoogleRoutesService,
  );

  return { service, computeRoute, findFirst, prisma };
}

/** Moves the stored driver fix so the next call sees a new origin. */
function moveTo(
  findFirst: jest.Mock,
  point: { latitude: number; longitude: number },
) {
  findFirst.mockResolvedValue({
    ...point,
    recordedAt: new Date('2026-09-18T12:05:00Z'),
  });
}

describe('OrderApproachService', () => {
  afterEach(() => jest.clearAllMocks());

  it('heads to the pickup while the trip has not started', async () => {
    const { service } = build({ status: 'ACCEPTED' });

    const result = await service.getForOrder('order-1');

    expect(result.targetStopType).toBe('PICKUP');
    expect(result.targetStopId).toBe('pickup-1');
    expect(result.route).toEqual(route);
  });

  it('heads to the dropoff once the order is in progress', async () => {
    const { service } = build({ status: 'IN_PROGRESS' });

    const result = await service.getForOrder('order-1');

    expect(result.targetStopType).toBe('DROPOFF');
    expect(result.targetStopId).toBe('dropoff-1');
  });

  it('returns no leg and never calls Google when the driver has no GPS fix', async () => {
    const { service, computeRoute } = build({ location: null });

    const result = await service.getForOrder('order-1');

    expect(result.route).toBeNull();
    expect(result.origin).toBeNull();
    expect(result.targetStopId).toBe('pickup-1');
    expect(computeRoute).not.toHaveBeenCalled();
  });

  it('reuses the cached leg while the driver stays within 200 m', async () => {
    const { service, computeRoute, findFirst } = build();

    await service.getForOrder('order-1');
    moveTo(findFirst, NEARBY);
    const second = await service.getForOrder('order-1');

    expect(computeRoute).toHaveBeenCalledTimes(1);
    expect(second.route).toEqual(route);
    // The origin still reports where the driver actually is.
    expect(second.origin).toEqual(NEARBY);
  });

  it('recomputes once the driver moves past 200 m', async () => {
    const { service, computeRoute, findFirst } = build();

    await service.getForOrder('order-1');
    moveTo(findFirst, FAR);
    await service.getForOrder('order-1');

    expect(computeRoute).toHaveBeenCalledTimes(2);
  });

  it('recomputes when the target stop changes even if the driver has not moved', async () => {
    const { service, computeRoute, prisma } = build({ status: 'ACCEPTED' });
    await service.getForOrder('order-1');

    // Same instance, because the cache lives on it: the driver picked up the
    // load, so the leg now has to point at the dropoff.
    prisma.transportOrder.findUnique.mockResolvedValue({
      status: 'IN_PROGRESS',
    });
    const second = await service.getForOrder('order-1');

    expect(computeRoute).toHaveBeenCalledTimes(2);
    expect(second.targetStopId).toBe('dropoff-1');
  });

  it('degrades to no leg when the provider fails, instead of throwing', async () => {
    const { service } = build({
      computeRoute: jest.fn().mockRejectedValue(new Error('provider denied')),
    });

    const result = await service.getForOrder('order-1');

    expect(result.route).toBeNull();
    expect(result.origin).toEqual(SANTO_DOMINGO);
  });

  it('throws when the order does not exist', async () => {
    const { service } = build({ status: '' });

    await expect(service.getForOrder('order-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
