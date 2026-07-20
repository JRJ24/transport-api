import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@generated/prisma/client';
import { TrackingSessionsService } from './tracking-sessions.service';
import type { PrismaService } from '@/database/prisma.service';
import type { RealtimeService } from '@/modules/realtime/realtime.service';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { trackingConfig } from '@/config';

const config = {
  maxAccuracyMeters: 100,
  maxSpeedMps: 70,
  maxBatchSize: 500,
} as ReturnType<typeof trackingConfig>;

const realtime = {
  emitLocation: jest.fn(),
  emitTripEvent: jest.fn(),
} as unknown as RealtimeService;

const driver: AuthenticatedUser = {
  id: 'user-driver',
  email: 'd@x.com',
  fullName: 'Driver',
  status: 'ACTIVE' as never,
  roles: ['DRIVER'] as never,
  permissions: [],
  sessionId: 's1',
};

const admin: AuthenticatedUser = { ...driver, roles: ['ADMIN'] as never };

function build(prisma: Record<string, unknown>) {
  return new TrackingSessionsService(
    prisma as unknown as PrismaService,
    realtime,
    config,
  );
}

describe('TrackingSessionsService', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects a driver with no assignment on the order', async () => {
    const prisma = {
      driverProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'drv' }) },
      orderAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = build(prisma);

    await expect(
      service.createOrRecover(driver, { orderId: 'order-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is idempotent: a duplicate clientId returns the existing location', async () => {
    const session = {
      id: 'sess-1',
      orderId: 'order-1',
      driverId: 'drv',
      status: 'ACTIVE',
    };
    const existing = { id: 'loc-existing' };
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });

    const prisma = {
      trackingSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn(),
      },
      orderAssignment: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ driverId: 'drv', vehicleId: 'veh' }),
      },
      driverLocation: {
        // 1st findFirst = anomaly "previous" lookup (none), 2nd = idempotency hit.
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(existing),
        create: jest.fn().mockRejectedValue(p2002),
      },
    };
    const service = build(prisma);

    const result = await service.addLocation(admin, 'sess-1', {
      latitude: 18.48,
      longitude: -69.93,
      recordedAt: new Date().toISOString(),
      sequence: 1,
      clientId: 'client-abc',
    });

    expect(result).toBe(existing);
    expect(prisma.driverLocation.create).toHaveBeenCalledTimes(1);
    expect(realtime.emitLocation).not.toHaveBeenCalled();
  });
});
