import RedisMock from 'ioredis-mock';
import { STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';
import type { matchingConfig, trackingConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import type { RedisService } from '@/database/redis.service';
import { GoogleRoutesError } from '@/integrations/google-maps/errors/google-routes.error';
import type { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import type { LatLng } from '@/integrations/google-maps/interfaces/route.interface';
import type { RealtimeService } from '@/modules/realtime/realtime.service';
import { PresenceService } from '../presence/presence.service';
import { MatchingService } from './matching.service';

const config = {
  h3Resolution: 8,
  maxRings: 3,
  minCandidates: 10,
  maxMatrixOrigins: 25,
  presenceTtlSec: 60,
  presenceMaxAccuracyM: 100,
  presenceMinIntervalMs: 0,
  autoOffer: 'off',
  offerTtlSec: 30,
  manualEnforce: 'off',
  sweepIntervalMs: 10_000,
  retryCooldownSec: 60,
  scoreVersion: 'v-test',
} as ReturnType<typeof matchingConfig>;

const tracking = {
  maxAccuracyMeters: 100,
  maxSpeedMps: 70,
  maxBatchSize: 500,
} as ReturnType<typeof trackingConfig>;

const PICKUP = { latitude: 18.4735, longitude: -69.9406 };
const CATEGORY = 'cat-van';
const FUTURE = new Date('2030-01-01');

interface DriverFixture {
  id: string;
  at: LatLng;
  status?: STATUS_DRIVER;
  verification?: VERIFICATION_STATUS;
  vehicle?: 'ok' | 'none' | 'expired-docs';
  activeTrip?: boolean;
  /** Road ETA to the pickup in seconds, or 'no-route'. */
  eta: number | 'no-route';
  rating?: number;
}

/** A point `metersNorth` north of the pickup (1° lat ≈ 111 km). */
const north = (metersNorth: number): LatLng => ({
  latitude: PICKUP.latitude + metersNorth / 111_000,
  longitude: PICKUP.longitude,
});

async function setup(
  drivers: DriverFixture[],
  options: { matrixFails?: boolean } = {},
) {
  const client = new RedisMock();
  await client.flushall();
  const redis = { client, isEnabled: true } as unknown as RedisService;

  const prisma = {
    transportOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'order-1',
        vehicleCategoryId: CATEGORY,
        orderStops: [PICKUP],
      }),
    },
    driverProfile: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        drivers
          .filter((driver) => where.id.in.includes(driver.id))
          .map((driver) => ({
            id: driver.id,
            availabilityStatus: driver.status ?? STATUS_DRIVER.AVAILABLE,
            verificationStatus:
              driver.verification ?? VERIFICATION_STATUS.APPROVED,
            licenseExpiration: FUTURE,
            ratingAVG: driver.rating ?? 4.5,
            user: { fullName: `Driver ${driver.id}` },
          })),
      ),
    },
    vehicle: {
      findMany: jest.fn(
        ({ where }: { where: { driverId: { in: string[] } } }) =>
          drivers
            .filter(
              (driver) =>
                where.driverId.in.includes(driver.id) &&
                (driver.vehicle ?? 'ok') !== 'none',
            )
            .map((driver) => ({
              id: `veh-${driver.id}`,
              driverId: driver.id,
              plateNumber: `A${driver.id}`,
              categoryId: CATEGORY,
              vehiclesDocuments:
                driver.vehicle === 'expired-docs'
                  ? [
                      {
                        documentType: 'INSURANCE',
                        status: 'APPROVED',
                        expirationDate: new Date('2020-01-01'),
                      },
                    ]
                  : [],
            })),
      ),
    },
    orderAssignment: {
      findMany: jest.fn(() =>
        drivers
          .filter((driver) => driver.activeTrip)
          .map((driver) => ({ driverId: driver.id })),
      ),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    driverOffer: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    systemParameter: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaService;

  const presence = new PresenceService(prisma, redis, config, tracking);
  const now = new Date();
  for (const driver of drivers) {
    await presence.record(driver.id, STATUS_DRIVER.AVAILABLE, {
      ...driver.at,
      accuracyM: 10,
      observedAt: now,
    });
  }

  const routes = {
    computeRouteMatrix: jest.fn((origins: LatLng[]) => {
      if (options.matrixFails) {
        return Promise.reject(new GoogleRoutesError('down'));
      }
      return Promise.resolve({
        provider: 'google-routes',
        computedAt: now.toISOString(),
        elements: origins.map((origin, originIndex) => {
          const driver = drivers.find(
            (candidate) =>
              candidate.at.latitude === origin.latitude &&
              candidate.at.longitude === origin.longitude,
          )!;
          return driver.eta === 'no-route'
            ? {
                originIndex,
                destinationIndex: 0,
                status: 'ROUTE_NOT_FOUND',
                distanceMeters: null,
                durationSeconds: null,
              }
            : {
                originIndex,
                destinationIndex: 0,
                status: 'OK',
                distanceMeters: Math.round(driver.eta * 8),
                durationSeconds: driver.eta,
              };
        }),
      });
    }),
  } as unknown as GoogleRoutesService;
  const realtime = { emitTripEvent: jest.fn() } as unknown as RealtimeService;

  return {
    service: new MatchingService(prisma, presence, routes, realtime, config),
    routes,
    realtime,
  };
}

describe('MatchingService.rankForOrder', () => {
  it('ranks by road ETA, not by straight line (spec acceptance 2)', async () => {
    const { service } = await setup([
      // 300 m away but on the other side of the river: 20 min by road.
      { id: 'near-slow', at: north(300), eta: 1200 },
      // 1.2 km away with a direct road: 4 min.
      { id: 'far-fast', at: north(1200), eta: 240 },
    ]);

    const result = await service.rankForOrder('order-1');

    expect(result.candidates.map((c) => c.driverId)).toEqual([
      'far-fast',
      'near-slow',
    ]);
    expect(result.candidates[0].rank).toBe(1);
    expect(result.candidates[0].etaSeconds).toBe(240);
    expect(result.scoreVersion).toBe('v-test');
  });

  it('excludes ineligible drivers and says why', async () => {
    const { service } = await setup([
      { id: 'ok', at: north(200), eta: 120 },
      { id: 'busy', at: north(250), eta: 130, status: STATUS_DRIVER.BUSY },
      {
        id: 'pending',
        at: north(260),
        eta: 130,
        verification: VERIFICATION_STATUS.PENDING,
      },
      { id: 'no-vehicle', at: north(270), eta: 130, vehicle: 'none' },
      { id: 'expired', at: north(280), eta: 130, vehicle: 'expired-docs' },
      { id: 'on-trip', at: north(290), eta: 130, activeTrip: true },
      { id: 'island', at: north(300), eta: 'no-route' },
    ]);

    const result = await service.rankForOrder('order-1');
    const reasons = Object.fromEntries(
      result.excluded.map((row) => [row.driverId, row.reason]),
    );

    expect(result.candidates.map((c) => c.driverId)).toEqual(['ok']);
    expect(reasons).toEqual({
      busy: 'NOT_AVAILABLE',
      pending: 'NOT_APPROVED',
      'no-vehicle': 'NO_ACTIVE_VEHICLE_IN_CATEGORY',
      expired: 'VEHICLE_DOCUMENTS_INVALID',
      'on-trip': 'ACTIVE_TRIP',
      island: 'NO_ROUTE_TO_PICKUP',
    });
  });

  it('grows the search ring by ring and records where each driver was found', async () => {
    const { service } = await setup([
      { id: 'here', at: PICKUP, eta: 60 },
      { id: 'farther', at: north(1500), eta: 300 },
    ]);

    const result = await service.rankForOrder('order-1');
    const ring = Object.fromEntries(
      result.candidates.map((c) => [c.driverId, c.ring]),
    );

    expect(ring.here).toBe(0);
    expect(ring.farther).toBeGreaterThan(0);
    expect(result.ringsSearched).toBe(config.maxRings);
  });

  it('never ranks a driver the caller asked to skip', async () => {
    const { service } = await setup([
      { id: 'a', at: north(200), eta: 60 },
      { id: 'b', at: north(400), eta: 120 },
    ]);

    const result = await service.rankForOrder('order-1', {
      excludeDriverIds: ['a'],
    });

    expect(result.candidates.map((c) => c.driverId)).toEqual(['b']);
    expect(result.excluded).toEqual([
      expect.objectContaining({ driverId: 'a', reason: 'ALREADY_OFFERED' }),
    ]);
  });

  it('marks ETAs as failed, never invented, when the provider is down', async () => {
    const { service, realtime } = await setup(
      [{ id: 'a', at: north(200), eta: 60 }],
      { matrixFails: true },
    );

    const result = await service.rankForOrder('order-1', { emitAlerts: true });

    expect(result.candidates[0]).toEqual(
      expect.objectContaining({ etaStatus: 'FAILED', etaSeconds: null }),
    );
    expect(result.alerts).toContain('ROUTES_PROVIDER_FAILED');
    expect(realtime.emitTripEvent).toHaveBeenCalledWith(
      'order-1',
      'matching.alert',
      expect.objectContaining({ alerts: ['ROUTES_PROVIDER_FAILED'] }),
    );
  });

  it('alerts operations when nobody can take the order', async () => {
    const { service, routes } = await setup([]);

    const result = await service.rankForOrder('order-1');

    expect(result.candidates).toEqual([]);
    expect(result.alerts).toEqual(['NO_CANDIDATES']);
    expect(routes.computeRouteMatrix).not.toHaveBeenCalled();
  });
});
