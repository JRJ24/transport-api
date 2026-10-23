import {
  ASSIGNMENT_STATUS,
  STATUS_DRIVER,
  STATUS_ORDERS,
  STATUS_VEHICLE,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { matchingConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import type { RealtimeService } from '@/modules/realtime/realtime.service';
import type { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import type { PresenceService } from '../presence/presence.service';
import { AssignmentsService } from './assignments.service';

const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;

function setup() {
  const assignment = {
    id: 'asg-1',
    orderId: 'order-1',
    driverId: 'd1',
    vehicleId: 'veh-1',
    assignmentStatus: ASSIGNMENT_STATUS.PENDING,
    assignedAt: new Date('2026-10-08T12:00:00.000Z'),
  };
  const tx = {
    transportOrder: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    driverProfile: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderAssignment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(assignment),
      findUniqueOrThrow: jest.fn().mockResolvedValue(assignment),
      create: jest.fn().mockResolvedValue(assignment),
    },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    transportOrder: {
      findUnique: jest.fn().mockResolvedValue({
        status: STATUS_ORDERS.REQUESTED,
        paymentStatus: 'PAID',
        vehicleCategoryId: 'cat-1',
      }),
    },
    driverProfile: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'd1',
        userId: 'user-d1',
        availabilityStatus: STATUS_DRIVER.AVAILABLE,
        verificationStatus: VERIFICATION_STATUS.APPROVED,
        licenseExpiration: new Date(Date.now() + 86_400_000),
      }),
    },
    orderAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    vehicle: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'veh-1',
        status: STATUS_VEHICLE.ACTIVE,
        categoryId: 'cat-1',
      }),
    },
  };
  const realtime = {
    emitOrderStatusChanged: jest.fn(),
    emitAssignmentCreated: jest.fn(),
    // reject saca al conductor de order:{id} despues de avisarle.
    revokeOrderRoom: jest.fn(),
  };
  const service = new AssignmentsService(
    prisma as unknown as PrismaService,
    {
      dispatch: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationDispatcherService,
    realtime as unknown as RealtimeService,
    {
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as PresenceService,
    { autoOffer: 'off' } as ReturnType<typeof matchingConfig>,
  );
  return { service, realtime, prisma, tx };
}

// La app del conductor recarga sus asignaciones con order.status.changed, asi
// que el evento debe llegar a su room aunque no tenga la orden abierta.
describe('AssignmentsService order-status announcements', () => {
  it('reaches the driver an operator assigns', async () => {
    const { service, realtime } = setup();

    await service.create(operator, {
      orderId: 'order-1',
      driverId: 'd1',
      vehicleId: 'veh-1',
    });

    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        status: STATUS_ORDERS.ASSIGNED,
        previousStatus: STATUS_ORDERS.REQUESTED,
        driverIds: ['d1'],
      }),
    );
  });

  it('reaches the driver whose assignment is accepted', async () => {
    const { service, realtime } = setup();

    await service.accept('asg-1', operator);

    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.ACCEPTED,
        previousStatus: STATUS_ORDERS.ASSIGNED,
        driverIds: ['d1'],
      }),
    );
  });

  it('reaches the driver whose assignment is rejected', async () => {
    const { service, realtime } = setup();

    await service.reject('asg-1', operator);

    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.REQUESTED,
        previousStatus: STATUS_ORDERS.ASSIGNED,
        driverIds: ['d1'],
      }),
    );
    // Pierde la room de la orden, pero solo despues de recibir el aviso.
    expect(realtime.revokeOrderRoom).toHaveBeenCalledWith('d1', 'order-1');
    expect(
      realtime.emitOrderStatusChanged.mock.invocationCallOrder[0],
    ).toBeLessThan(realtime.revokeOrderRoom.mock.invocationCallOrder[0]);
  });

  it('keeps the room of the driver whose assignment is accepted', async () => {
    const { service, realtime } = setup();

    await service.accept('asg-1', operator);

    expect(realtime.revokeOrderRoom).not.toHaveBeenCalled();
  });
});

// OrdersService.cancel/updateStatus bloquean la orden y luego sus
// asignaciones; accept y reject tienen que ir en el mismo orden o una
// cancelacion simultanea termina en deadlock.
describe('AssignmentsService lock order', () => {
  it('accept locks the order before the assignment', async () => {
    const { service, tx } = setup();

    await service.accept('asg-1', operator);

    expect(tx.transportOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: STATUS_ORDERS.ASSIGNED },
      data: { status: STATUS_ORDERS.ACCEPTED },
    });
    expect(tx.orderAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: 'asg-1', assignmentStatus: ASSIGNMENT_STATUS.PENDING },
      data: expect.objectContaining({
        assignmentStatus: ASSIGNMENT_STATUS.ACCEPTED,
      }),
    });
    expect(
      tx.transportOrder.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.orderAssignment.updateMany.mock.invocationCallOrder[0]);
  });

  it('reject locks the order before the assignment', async () => {
    const { service, tx } = setup();

    await service.reject('asg-1', operator);

    expect(tx.transportOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: STATUS_ORDERS.ASSIGNED },
      data: { status: STATUS_ORDERS.REQUESTED },
    });
    expect(
      tx.transportOrder.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.orderAssignment.updateMany.mock.invocationCallOrder[0]);
  });

  it('keeps the 409 for an assignment that is no longer pending, without touching the order', async () => {
    const { service, tx, realtime } = setup();
    tx.orderAssignment.findUnique.mockResolvedValue({
      id: 'asg-1',
      orderId: 'order-1',
      driverId: 'd1',
      assignmentStatus: ASSIGNMENT_STATUS.CANCELLED,
    });

    await expect(service.accept('asg-1', operator)).rejects.toMatchObject({
      status: 409,
      response: { message: 'Assignment is no longer pending' },
    });
    await expect(service.reject('asg-1', operator)).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.transportOrder.updateMany).not.toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('keeps the 404 for an unknown assignment', async () => {
    const { service, tx } = setup();
    tx.orderAssignment.findUnique.mockResolvedValue(null);

    await expect(service.accept('nope', operator)).rejects.toMatchObject({
      status: 404,
    });
    expect(tx.transportOrder.updateMany).not.toHaveBeenCalled();
  });

  it('accept answers 409 when the order stopped waiting for the driver', async () => {
    const { service, tx } = setup();
    tx.transportOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.accept('asg-1', operator)).rejects.toMatchObject({
      status: 409,
      response: { message: 'Order is no longer waiting for this driver' },
    });
    expect(tx.orderAssignment.updateMany).not.toHaveBeenCalled();
  });
});

describe('AssignmentsService.listMine privacy (SEC-API-008)', () => {
  const viewer = { id: 'driver-user', roles: ['DRIVER'] } as AuthenticatedUser;
  const activeAssignments = [
    ASSIGNMENT_STATUS.PENDING,
    ASSIGNMENT_STATUS.ACCEPTED,
  ];
  const activeOrders: STATUS_ORDERS[] = [
    STATUS_ORDERS.ASSIGNED,
    STATUS_ORDERS.ACCEPTED,
    STATUS_ORDERS.IN_PROGRESS,
  ];

  function row(
    assignmentStatus: ASSIGNMENT_STATUS,
    status: STATUS_ORDERS = STATUS_ORDERS.ASSIGNED,
    id = 'asg-1',
  ) {
    return {
      id,
      orderId: `order-${id}`,
      driverId: 'd1',
      vehicleId: 'v1',
      assignedAt: new Date('2026-10-23T12:00:00Z'),
      assignedBy: null,
      acceptedAt: null,
      rejectedAt: null,
      assignmentStatus,
      order: {
        id: `order-${id}`,
        orderCode: `ORD-${id}`,
        customerId: 'customer-1',
        vehicleCategoryId: 'category-1',
        serviceType: 'INMEDIATE',
        status,
        totalAmount: 1200,
        paymentStatus: 'PAID',
        notes: 'Call Private Person at 809-555-0199, Secret Street 123',
        orderStops: [
          {
            contactName: 'Private Person',
            contactPhone: '809-555-0199',
            addressLine: 'Secret Street 123',
            city: 'Santo Domingo',
            province: 'Distrito Nacional',
            latitude: 18.4861,
            longitude: -69.9312,
            instructions: 'Gate code 2468',
          },
        ],
        orderItems: [{ description: 'Private cargo details', quantity: 1 }],
      },
      driver: { id: 'd1', user: { id: viewer.id } },
      vehicle: { id: 'v1' },
    };
  }
  type Row = ReturnType<typeof row>;

  function setupListMine(rows: Row[], noProfile = false) {
    const prisma = {
      driverProfile: {
        findFirst: jest.fn().mockResolvedValue(noProfile ? null : { id: 'd1' }),
      },
      orderAssignment: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const service = new AssignmentsService(
      prisma as unknown as PrismaService,
      {} as NotificationDispatcherService,
      {} as RealtimeService,
      {} as PresenceService,
      { autoOffer: 'off' } as ReturnType<typeof matchingConfig>,
    );
    const list = async (user = viewer) =>
      (await service.listMine(user)) as Row[];
    return { prisma, service, list };
  }

  function expectPrivateDetailsHidden(actual: Row, original: Row) {
    expect(actual).toMatchObject({
      id: original.id,
      assignmentStatus: original.assignmentStatus,
      assignedAt: original.assignedAt,
      order: {
        id: original.order.id,
        orderCode: original.order.orderCode,
        status: original.order.status,
        totalAmount: original.order.totalAmount,
        orderStops: [],
        orderItems: [],
        notes: '',
      },
    });
    const serialized = JSON.stringify(actual);
    for (const secret of [
      'Private Person',
      '809-555-0199',
      'Secret Street 123',
      'Gate code 2468',
      '18.4861',
      '-69.9312',
      'Private cargo details',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  }

  describe('US1: historical assignments no longer disclose contact details', () => {
    it.each([
      ASSIGNMENT_STATUS.REJECTED,
      ASSIGNMENT_STATUS.CANCELLED,
      ASSIGNMENT_STATUS.COMPLETED,
    ])('redacts %s while keeping the historical summary', async (status) => {
      const original = row(status);
      const { list } = setupListMine([original]);
      const [result] = await list();
      expectPrivateDetailsHidden(result, original);
    });

    it.each(
      Object.values(STATUS_ORDERS).filter(
        (status) => !activeOrders.includes(status),
      ),
    )('redacts an ACCEPTED assignment when the order is %s', async (status) => {
      const original = row(ASSIGNMENT_STATUS.ACCEPTED, status);
      const { list } = setupListMine([original]);
      expectPrivateDetailsHidden((await list())[0], original);
    });

    it('also redacts a PENDING assignment on a cancelled order', async () => {
      const original = row(ASSIGNMENT_STATUS.PENDING, STATUS_ORDERS.CANCELLED);
      const { list } = setupListMine([original]);
      expectPrivateDetailsHidden((await list())[0], original);
    });

    it('does not bypass privacy for a driver with an additional staff role', async () => {
      const original = row(ASSIGNMENT_STATUS.REJECTED);
      const { list } = setupListMine([original]);
      const result = await list({ ...viewer, roles: ['DRIVER', 'ADMIN'] });
      expectPrivateDetailsHidden(result[0], original);
    });
  });

  describe('US2: preserve active work and the history contract', () => {
    it.each(
      activeAssignments.flatMap((assignment) =>
        activeOrders.map((order) => [assignment, order] as const),
      ),
    )(
      'keeps operational details for %s on a %s order',
      async (assignment, order) => {
        const original = row(assignment, order);
        const { list } = setupListMine([original]);
        expect((await list())[0]).toEqual(original);
      },
    );

    it('preserves row order and metadata without mutating the original rows', async () => {
      const rows = [
        row(ASSIGNMENT_STATUS.REJECTED, STATUS_ORDERS.ASSIGNED, 'newest'),
        row(ASSIGNMENT_STATUS.ACCEPTED, STATUS_ORDERS.IN_PROGRESS, 'current'),
        row(ASSIGNMENT_STATUS.COMPLETED, STATUS_ORDERS.DELIVERED, 'oldest'),
      ];
      const snapshots = structuredClone(rows);
      const { list } = setupListMine(rows);
      const result = await list();
      expect(result.map((item) => item.id)).toEqual([
        'newest',
        'current',
        'oldest',
      ]);
      expectPrivateDetailsHidden(result[0], snapshots[0]);
      expect(result[1]).toEqual(snapshots[1]);
      expectPrivateDetailsHidden(result[2], snapshots[2]);
      expect(result.map((item) => ({ ...item, order: undefined }))).toEqual(
        snapshots.map((item) => ({ ...item, order: undefined })),
      );
      expect(rows).toEqual(snapshots);
    });

    it('queries only the authenticated driver in the existing descending order', async () => {
      const { list, prisma } = setupListMine([]);
      await list();
      expect(prisma.driverProfile.findFirst).toHaveBeenCalledWith({
        where: { userId: viewer.id },
      });
      expect(prisma.orderAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { driverId: 'd1' },
          orderBy: { assignedAt: 'desc' },
        }),
      );
    });

    it('returns an empty list without a profile', async () => {
      const { list, prisma } = setupListMine([], true);
      expect(await list()).toEqual([]);
      expect(prisma.orderAssignment.findMany).not.toHaveBeenCalled();
    });

    it('keeps the administrative listing untouched', async () => {
      const original = row(ASSIGNMENT_STATUS.REJECTED);
      const { service, prisma } = setupListMine([original]);
      expect(await service.list()).toEqual([original]);
      expect(prisma.driverProfile.findFirst).not.toHaveBeenCalled();
    });
  });
});
