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
  return { service, realtime };
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
