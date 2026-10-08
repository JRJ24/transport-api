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
