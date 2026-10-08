import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
  deliveredGraceSeconds: 300,
} as ReturnType<typeof trackingConfig>;

const realtime = {
  emitLocation: jest.fn(),
  emitTripEvent: jest.fn(),
  emitOrderStatusChanged: jest.fn(),
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

function build(
  prisma: Record<string, unknown>,
  overrides: Partial<ReturnType<typeof trackingConfig>> = {},
) {
  return new TrackingSessionsService(
    prisma as unknown as PrismaService,
    realtime,
    { ...config, ...overrides },
  );
}

const activeSession = {
  id: 'sess-1',
  orderId: 'order-1',
  driverId: 'drv',
  status: 'ACTIVE',
};

function point(sequence: number) {
  return {
    latitude: 18.48,
    longitude: -69.93,
    recordedAt: new Date().toISOString(),
    sequence,
    clientId: `client-${sequence}`,
  };
}

/** Prisma para add*: sesion del conductor 'drv' y la asignacion indicada. */
function locationPrisma(assignment: unknown) {
  return {
    driverProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'drv' }) },
    trackingSession: {
      findUnique: jest.fn().mockResolvedValue(activeSession),
      update: jest.fn().mockResolvedValue(activeSession),
    },
    orderAssignment: { findFirst: jest.fn().mockResolvedValue(assignment) },
    driverLocation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'loc-1' }),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

const acceptedAssignment = {
  vehicleId: 'veh',
  assignmentStatus: 'ACCEPTED',
  order: { deliveredAt: null },
};

function completedAssignment(deliveredSecondsAgo: number | null) {
  return {
    vehicleId: 'veh',
    assignmentStatus: 'COMPLETED',
    order: {
      deliveredAt:
        deliveredSecondsAgo === null
          ? null
          : new Date(Date.now() - deliveredSecondsAgo * 1000),
    },
  };
}

/** Prisma para createOrRecover; `moved` = filas que pasan a IN_PROGRESS. */
function sessionPrisma(opts: { active?: unknown; moved?: number } = {}) {
  const tx = {
    trackingSession: {
      create: jest.fn().mockResolvedValue({ ...activeSession, id: 'sess-new' }),
    },
    transportOrder: {
      updateMany: jest.fn().mockResolvedValue({ count: opts.moved ?? 1 }),
    },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    driverProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'drv' }) },
    orderAssignment: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ driverId: 'drv', vehicleId: 'veh' }),
    },
    trackingSession: {
      findFirst: jest.fn().mockResolvedValue(opts.active ?? null),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx };
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

  describe('createOrRecover', () => {
    it('moves an ACCEPTED order to IN_PROGRESS with an event and a status emit', async () => {
      const { prisma, tx } = sessionPrisma({ moved: 1 });
      const service = build(prisma);

      const session = await service.createOrRecover(driver, {
        orderId: 'order-1',
      });

      expect(session.id).toBe('sess-new');
      expect(tx.transportOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: 'ACCEPTED' },
        data: { status: 'IN_PROGRESS', pickupAt: expect.any(Date) },
      });
      expect(tx.orderEvent.create).toHaveBeenCalledWith({
        data: {
          orderId: 'order-1',
          eventType: 'IN_TRANSIT',
          actorUserId: 'user-driver',
          description: 'Order status changed to IN_PROGRESS',
          metadata: { status: 'IN_PROGRESS' },
          latitude: null,
          longitude: null,
        },
      });
      expect(realtime.emitOrderStatusChanged).toHaveBeenCalledTimes(1);
      expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith({
        orderId: 'order-1',
        status: 'IN_PROGRESS',
        previousStatus: 'ACCEPTED',
        changedByUserId: 'user-driver',
        changedAt: expect.any(String),
        driverIds: ['drv'],
      });
      expect(realtime.emitTripEvent).toHaveBeenCalledWith(
        'order-1',
        'tracking:started',
        session,
      );
    });

    it('does not overwrite pickupAt, log an event or emit when the order is past ACCEPTED', async () => {
      const { prisma, tx } = sessionPrisma({ moved: 0 });
      const service = build(prisma);

      await service.createOrRecover(driver, { orderId: 'order-1' });

      expect(tx.trackingSession.create).toHaveBeenCalledTimes(1);
      expect(tx.orderEvent.create).not.toHaveBeenCalled();
      expect(realtime.emitOrderStatusChanged).not.toHaveBeenCalled();
      expect(realtime.emitTripEvent).toHaveBeenCalledWith(
        'order-1',
        'tracking:started',
        expect.anything(),
      );
    });

    it('emits nothing when the transaction fails', async () => {
      const { prisma, tx } = sessionPrisma({ moved: 1 });
      tx.orderEvent.create.mockRejectedValue(new Error('db down'));
      const service = build(prisma);

      await expect(
        service.createOrRecover(driver, { orderId: 'order-1' }),
      ).rejects.toThrow('db down');

      // Los emits van despues del commit: un rollback no anuncia nada.
      expect(realtime.emitOrderStatusChanged).not.toHaveBeenCalled();
      expect(realtime.emitTripEvent).not.toHaveBeenCalled();
    });

    it('recovers the active session without any transition or emit', async () => {
      const { prisma } = sessionPrisma({ active: activeSession });
      const service = build(prisma);

      const session = await service.createOrRecover(driver, {
        orderId: 'order-1',
      });

      expect(session).toBe(activeSession);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(realtime.emitOrderStatusChanged).not.toHaveBeenCalled();
      expect(realtime.emitTripEvent).not.toHaveBeenCalled();
    });
  });

  describe('points after delivery', () => {
    it('addLocation accepts points of a COMPLETED assignment right after delivery', async () => {
      const prisma = locationPrisma(completedAssignment(30));
      const service = build(prisma);

      await service.addLocation(driver, 'sess-1', point(1));

      expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            orderId: 'order-1',
            driverId: 'drv',
            assignmentStatus: { in: ['ACCEPTED', 'COMPLETED'] },
          },
        }),
      );
      expect(prisma.driverLocation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          driverId: 'drv',
          vehicleId: 'veh',
          sessionId: 'sess-1',
        }),
      });
      expect(realtime.emitLocation).toHaveBeenCalled();
    });

    it('addLocationBatch accepts the final flush of a COMPLETED assignment', async () => {
      const prisma = locationPrisma(completedAssignment(30));
      const service = build(prisma);

      const result = await service.addLocationBatch(driver, 'sess-1', [
        point(1),
        point(2),
      ]);

      expect(result).toMatchObject({ received: 2, accepted: 2 });
      expect(prisma.driverLocation.createMany).toHaveBeenCalledTimes(1);
    });

    it('still accepts points of an ACCEPTED assignment', async () => {
      const prisma = locationPrisma(acceptedAssignment);
      const service = build(prisma);

      await expect(
        service.addLocationBatch(driver, 'sess-1', [point(1)]),
      ).resolves.toMatchObject({ received: 1 });
    });

    it.each([
      ['after the grace window', 301],
      ['with no delivery date', null],
    ])(
      'rejects a COMPLETED assignment %s so the app stops its GPS',
      async (_label, secondsAgo) => {
        const prisma = locationPrisma(completedAssignment(secondsAgo));
        const service = build(prisma);

        const single: unknown = await service
          .addLocation(driver, 'sess-1', point(1))
          .catch((e: unknown) => e);
        const batch: unknown = await service
          .addLocationBatch(driver, 'sess-1', [point(1)])
          .catch((e: unknown) => e);

        // La app solo apaga el GPS ante un 403 con code FORBIDDEN o
        // DOMAIN_RULE_VIOLATION (isSessionRejected): el cuerpo debe seguir igual.
        for (const error of [single, batch]) {
          expect(error).toBeInstanceOf(ForbiddenException);
          expect((error as ForbiddenException).getResponse()).toEqual({
            code: 'FORBIDDEN',
            message: 'Driver is not assigned to this order',
          });
        }
        expect(prisma.driverLocation.create).not.toHaveBeenCalled();
        expect(prisma.driverLocation.createMany).not.toHaveBeenCalled();
      },
    );

    it('checks an operator posting points against the session driver', async () => {
      const prisma = locationPrisma(acceptedAssignment);
      const service = build(prisma);

      await service.addLocationBatch(admin, 'sess-1', [point(1)]);

      expect(prisma.driverProfile.findFirst).not.toHaveBeenCalled();
      expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ driverId: 'drv' }),
        }),
      );
      expect(prisma.driverLocation.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ driverId: 'drv', vehicleId: 'veh' })],
        skipDuplicates: true,
      });
    });

    it('rejects when the session driver has no accepted or completed assignment', async () => {
      const prisma = locationPrisma(null);
      const service = build(prisma);

      await expect(
        service.addLocationBatch(driver, 'sess-1', [point(1)]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('batch size', () => {
    it('rejects a batch above TRACKING_MAX_BATCH with 400 before touching the db', async () => {
      const prisma = locationPrisma(acceptedAssignment);
      const service = build(prisma, { maxBatchSize: 2 });

      const error: unknown = await service
        .addLocationBatch(driver, 'sess-1', [point(1), point(2), point(3)])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'VALIDATION_FAILED',
        message: 'Batch too large: 3 locations (max 2)',
      });
      expect(prisma.trackingSession.findUnique).not.toHaveBeenCalled();
    });

    it('accepts a batch exactly at the limit', async () => {
      const prisma = locationPrisma(acceptedAssignment);
      const service = build(prisma, { maxBatchSize: 2 });

      await expect(
        service.addLocationBatch(driver, 'sess-1', [point(1), point(2)]),
      ).resolves.toMatchObject({ received: 2, accepted: 2 });
    });
  });
});
