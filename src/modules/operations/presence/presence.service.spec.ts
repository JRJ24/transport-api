import RedisMock from 'ioredis-mock';
import { STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';
import type { matchingConfig, trackingConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import type { RedisService } from '@/database/redis.service';
import { h3CellOf } from '@/common/utils/geo.util';
import { PresenceService } from './presence.service';

const config = {
  h3Resolution: 8,
  maxRings: 3,
  minCandidates: 5,
  maxMatrixOrigins: 25,
  presenceTtlSec: 60,
  presenceMaxAccuracyM: 100,
  presenceMinIntervalMs: 3000,
  autoOffer: 'off',
  offerTtlSec: 30,
  manualEnforce: 'off',
  sweepIntervalMs: 10_000,
  retryCooldownSec: 60,
  scoreVersion: 'v1',
} as ReturnType<typeof matchingConfig>;

const tracking = {
  maxAccuracyMeters: 100,
  maxSpeedMps: 70,
  maxBatchSize: 500,
} as ReturnType<typeof trackingConfig>;

/** Santo Domingo, Piantini, and a point ~1.4 km away. */
const PIANTINI = { latitude: 18.4735, longitude: -69.9406 };
const NACO = { latitude: 18.4847, longitude: -69.9338 };

function makeService(
  driver: Record<string, unknown> | null = {
    id: 'driver-1',
    availabilityStatus: STATUS_DRIVER.AVAILABLE,
    verificationStatus: VERIFICATION_STATUS.APPROVED,
  },
) {
  const client = new RedisMock();
  const redis = { client, isEnabled: true } as unknown as RedisService;
  const prisma = {
    driverProfile: { findFirst: jest.fn().mockResolvedValue(driver) },
  } as unknown as PrismaService;
  const service = new PresenceService(prisma, redis, config, tracking);
  return { service, client, prisma };
}

const at = (iso: string) => new Date(iso);
const fix = (point: typeof PIANTINI, observedAt: string, accuracyM = 10) => ({
  ...point,
  accuracyM,
  observedAt,
});

describe('PresenceService.record', () => {
  afterEach(async () => {
    await new RedisMock().flushall();
  });

  it('stores the fix and indexes the driver under its H3 cell', async () => {
    const { service } = makeService();
    const now = at('2026-09-29T12:00:00Z');

    const result = await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, now.toISOString()),
      now,
    );

    const cell = h3CellOf(PIANTINI, 8);
    expect(result).toEqual(
      expect.objectContaining({ accepted: true, h3Cell: cell }),
    );
    expect((await service.membersOfCells([cell], now)).fresh).toEqual([
      'driver-1',
    ]);
  });

  it('moves the driver out of the old cell when it changes cell', async () => {
    const { service } = makeService();
    const t0 = at('2026-09-29T12:00:00Z');
    const t1 = at('2026-09-29T12:02:00Z');

    await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, t0.toISOString()),
      t0,
    );
    await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(NACO, t1.toISOString()),
      t1,
    );

    const oldCell = h3CellOf(PIANTINI, 8);
    const newCell = h3CellOf(NACO, 8);
    expect(oldCell).not.toBe(newCell);
    expect((await service.membersOfCells([oldCell], t1)).fresh).toEqual([]);
    expect((await service.membersOfCells([newCell], t1)).fresh).toEqual([
      'driver-1',
    ]);
  });

  it.each([
    ['LOW_ACCURACY', { ...PIANTINI, accuracyM: 250 }],
    ['MISSING_ACCURACY', { ...PIANTINI }],
    ['MOCKED_LOCATION', { ...PIANTINI, accuracyM: 5, isMocked: true }],
    [
      'OUT_OF_SERVICE_AREA',
      { latitude: 40.4168, longitude: -3.7038, accuracyM: 5 },
    ],
    [
      'INVALID_COORDINATES',
      { latitude: Number.NaN, longitude: 0, accuracyM: 5 },
    ],
  ])('rejects %s fixes', async (reason, input) => {
    const { service } = makeService();

    const result = await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      input,
    );

    expect(result).toEqual({ accepted: false, reason });
  });

  it('rejects fixes that are too old or from the future', async () => {
    const { service } = makeService();
    const now = at('2026-09-29T12:00:00Z');

    const stale = await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, '2026-09-29T11:58:00Z'),
      now,
    );
    const future = await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, '2026-09-29T12:05:00Z'),
      now,
    );

    expect(stale).toEqual({ accepted: false, reason: 'STALE_TIMESTAMP' });
    expect(future).toEqual({ accepted: false, reason: 'FUTURE_TIMESTAMP' });
  });

  it('rejects fixes out of order, throttled or implying an impossible jump', async () => {
    const { service } = makeService();
    const t0 = at('2026-09-29T12:00:00Z');
    await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, t0.toISOString()),
      t0,
    );

    const throttled = await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, '2026-09-29T12:00:01Z'),
      at('2026-09-29T12:00:01Z'),
    );
    const outOfOrder = await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, '2026-09-29T11:59:50Z'),
      at('2026-09-29T12:00:10Z'),
    );
    // ~1.4 km in 5 s is ~280 m/s.
    const jump = await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(NACO, '2026-09-29T12:00:05Z'),
      at('2026-09-29T12:00:05Z'),
    );

    expect(throttled).toEqual({ accepted: false, reason: 'THROTTLED' });
    expect(outOfOrder).toEqual({ accepted: false, reason: 'OUT_OF_ORDER' });
    expect(jump).toEqual({ accepted: false, reason: 'IMPOSSIBLE_JUMP' });
  });

  it('keeps a stale position visible as stale, with why the next fix was refused', async () => {
    const { service } = makeService();
    const t0 = at('2026-09-29T12:00:00Z');
    await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, t0.toISOString()),
      t0,
    );
    const later = at('2026-09-29T12:03:00Z');
    await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, later.toISOString(), 400),
      later,
    );

    const members = await service.membersOfCells(
      [h3CellOf(PIANTINI, 8)],
      later,
    );
    const record = await service.get('driver-1');

    expect(members).toEqual({ fresh: [], stale: ['driver-1'] });
    expect(record?.lastRejection).toBe('LOW_ACCURACY');
    expect(service.isFresh(record!, later)).toBe(false);
  });

  it('removes a driver completely', async () => {
    const { service } = makeService();
    const now = at('2026-09-29T12:00:00Z');
    await service.record(
      'driver-1',
      STATUS_DRIVER.AVAILABLE,
      fix(PIANTINI, now.toISOString()),
      now,
    );

    await service.remove('driver-1');

    expect(await service.get('driver-1')).toBeNull();
    expect(await service.membersOfCells([h3CellOf(PIANTINI, 8)], now)).toEqual({
      fresh: [],
      stale: [],
    });
  });
});

describe('PresenceService.recordForUser', () => {
  afterEach(async () => {
    await new RedisMock().flushall();
  });

  it('only accepts approved, available drivers', async () => {
    const busy = makeService({
      id: 'driver-1',
      availabilityStatus: STATUS_DRIVER.BUSY,
      verificationStatus: VERIFICATION_STATUS.APPROVED,
    });
    const pending = makeService({
      id: 'driver-2',
      availabilityStatus: STATUS_DRIVER.AVAILABLE,
      verificationStatus: VERIFICATION_STATUS.PENDING,
    });
    const missing = makeService(null);
    const input = { ...PIANTINI, accuracyM: 10 };

    expect(await busy.service.recordForUser('user-1', input)).toEqual({
      accepted: false,
      reason: 'DRIVER_NOT_AVAILABLE',
    });
    expect(await pending.service.recordForUser('user-2', input)).toEqual({
      accepted: false,
      reason: 'DRIVER_NOT_APPROVED',
    });
    expect(await missing.service.recordForUser('user-3', input)).toEqual({
      accepted: false,
      reason: 'DRIVER_NOT_FOUND',
    });
  });

  it('caches the driver status instead of reading it on every ping', async () => {
    const { service, prisma } = makeService();

    await service.recordForUser('user-1', { ...PIANTINI, accuracyM: 10 });
    await service.recordForUser('user-1', { ...PIANTINI, accuracyM: 10 });

    expect(prisma.driverProfile.findFirst).toHaveBeenCalledTimes(1);
  });
});
