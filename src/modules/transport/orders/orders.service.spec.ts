import {
  ASSIGNMENT_STATUS,
  OFFER_MODE,
  OFFER_STATUS,
  ORDER_CANCELLATION,
  STATUS_DRIVER,
  STATUS_ORDERS,
  TRACKING_SESSIONS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import type { AssignmentsService } from '@/modules/operations/assignments/assignments.service';
import type { RealtimeService } from '@/modules/realtime/realtime.service';
import type { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import type { PricingService } from '../pricing/pricing.service';
import { OrdersService } from './orders.service';

const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;
const driverUser = { id: 'user-d1', roles: ['DRIVER'] } as AuthenticatedUser;
const customerUser = {
  id: 'user-c1',
  roles: ['CUSTOMER'],
} as AuthenticatedUser;

const LIVE = [ASSIGNMENT_STATUS.PENDING, ASSIGNMENT_STATUS.ACCEPTED];

interface SetupOptions {
  status?: STATUS_ORDERS;
  /** Asignaciones vivas que encuentra la transaccion. */
  live?: { id: string; driverId: string }[];
  /** Asignaciones de la orden tal como se releen al final. */
  reread?: { driverId: string; assignmentStatus: ASSIGNMENT_STATUS }[];
  offers?: Record<string, unknown>[];
}

function setup(options: SetupOptions = {}) {
  const live = options.live ?? [{ id: 'asg-1', driverId: 'd1' }];
  const order = {
    id: 'order-1',
    orderCode: 'ORD-1',
    customerId: 'cust-1',
    status: options.status ?? STATUS_ORDERS.ACCEPTED,
    orderAssignments: options.reread ?? [],
  };
  const tx = {
    transportOrder: {
      update: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
    },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
    orderCancellation: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    priceQuote: { update: jest.fn().mockResolvedValue({}) },
    orderAssignment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'asg-1', driverId: 'd1' }),
      findMany: jest.fn().mockResolvedValue(live),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: live.length }),
    },
    driverProfile: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    trackingSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    transportOrder: {
      findUnique: jest.fn().mockResolvedValue({
        status: options.status ?? STATUS_ORDERS.ACCEPTED,
        paymentStatus: 'PAID',
        customerId: 'cust-1',
      }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'order-1',
        status: STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
        quoteId: null,
        totalAmount: 1500,
      }),
    },
    driverProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'd1' }) },
    orderAssignment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'asg-1' }),
    },
    driverOffer: {
      findMany: jest.fn().mockResolvedValue(options.offers ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    deliveryProof: {
      findMany: jest.fn().mockResolvedValue([{ id: 'proof-1' }]),
    },
    attachment: { findFirst: jest.fn().mockResolvedValue({ id: 'att-1' }) },
    signature: { findFirst: jest.fn().mockResolvedValue({ id: 'sig-1' }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    customerProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }),
    },
  };
  const realtime = {
    emitOrderStatusChanged: jest.fn(),
    emitOfferUpdated: jest.fn(),
  };
  const notifications = { dispatch: jest.fn().mockResolvedValue(undefined) };

  const service = new OrdersService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeService,
    {} as AssignmentsService,
    notifications as unknown as NotificationDispatcherService,
    {} as PricingService,
  );
  return { service, prisma, tx, realtime };
}

/** Lo que una orden cancelada o fallida debe dejar hecho en la transaccion. */
function expectDriversReleased(tx: ReturnType<typeof setup>['tx']) {
  expect(tx.orderAssignment.findMany).toHaveBeenCalledWith({
    where: { orderId: 'order-1', assignmentStatus: { in: LIVE } },
    select: { id: true, driverId: true },
  });
  expect(tx.orderAssignment.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['asg-1'] }, assignmentStatus: { in: LIVE } },
    data: { assignmentStatus: ASSIGNMENT_STATUS.CANCELLED },
  });
  // Solo quien estaba BUSY y sin otro viaje vivo vuelve a AVAILABLE.
  expect(tx.driverProfile.updateMany).toHaveBeenCalledWith({
    where: {
      id: { in: ['d1'] },
      availabilityStatus: STATUS_DRIVER.BUSY,
      orderAssignments: {
        none: {
          orderId: { not: 'order-1' },
          assignmentStatus: { in: LIVE },
          order: {
            status: {
              in: [
                STATUS_ORDERS.ASSIGNED,
                STATUS_ORDERS.ACCEPTED,
                STATUS_ORDERS.IN_PROGRESS,
              ],
            },
          },
        },
      },
    },
    data: { availabilityStatus: STATUS_DRIVER.AVAILABLE },
  });
  expect(tx.trackingSession.updateMany).toHaveBeenCalledWith({
    where: { orderId: 'order-1', status: TRACKING_SESSIONS.ACTIVE },
    data: { status: TRACKING_SESSIONS.ENDED, endedAt: expect.any(Date) },
  });
  // La orden se bloquea antes de buscar asignaciones: un claim concurrente
  // espera y luego la ve cerrada.
  expect(tx.transportOrder.update.mock.invocationCallOrder[0]).toBeLessThan(
    tx.orderAssignment.findMany.mock.invocationCallOrder[0],
  );
}

describe('OrdersService.cancel', () => {
  const dto = {
    cancellationType: ORDER_CANCELLATION.ADMIN_CANCELLED,
    reason: ' Cliente no responde ',
  };

  it('closes the assignment, frees the driver and ends tracking in the same transaction', async () => {
    const { service, prisma, tx, realtime } = setup();

    await service.cancel(operator, 'order-1', dto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.transportOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: STATUS_ORDERS.CANCELLED },
    });
    expectDriversReleased(tx);
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        status: STATUS_ORDERS.CANCELLED,
        changedByUserId: 'user-op',
        driverIds: ['d1'],
      }),
    );
  });

  it('returns the order re-read after the assignments were cancelled', async () => {
    const { service, tx } = setup({
      reread: [
        { driverId: 'd1', assignmentStatus: ASSIGNMENT_STATUS.CANCELLED },
      ],
    });

    const order = await service.cancel(operator, 'order-1', dto);

    expect(tx.transportOrder.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' } }),
    );
    expect(
      (order as unknown as { orderAssignments: unknown[] }).orderAssignments,
    ).toEqual([
      { driverId: 'd1', assignmentStatus: ASSIGNMENT_STATUS.CANCELLED },
    ]);
  });

  it('only ends tracking when nobody held the order', async () => {
    const { service, tx, realtime } = setup({ live: [] });

    await service.cancel(operator, 'order-1', dto);

    expect(tx.orderAssignment.updateMany).not.toHaveBeenCalled();
    expect(tx.driverProfile.updateMany).not.toHaveBeenCalled();
    expect(tx.trackingSession.updateMany).toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ driverIds: [] }),
    );
  });

  it('cancels an open offer after the commit and tells the offered driver', async () => {
    const expiresAt = new Date('2026-10-08T12:00:30.000Z');
    const { service, prisma, tx, realtime } = setup({
      live: [],
      offers: [
        {
          id: 'offer-1',
          orderId: 'order-1',
          driverId: 'd7',
          mode: OFFER_MODE.AUTO,
          rank: 1,
          etaSeconds: 240,
          expiresAt,
        },
      ],
    });

    await service.cancel(operator, 'order-1', dto);

    expect(prisma.driverOffer.findMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', status: OFFER_STATUS.PENDING },
    });
    expect(prisma.driverOffer.updateMany).toHaveBeenCalledWith({
      where: { id: 'offer-1', status: OFFER_STATUS.PENDING },
      data: expect.objectContaining({ status: OFFER_STATUS.CANCELLED }),
    });
    expect(tx.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.driverOffer.updateMany.mock.invocationCallOrder[0],
    );
    expect(realtime.emitOfferUpdated).toHaveBeenCalledWith({
      offerId: 'offer-1',
      orderId: 'order-1',
      driverId: 'd7',
      status: OFFER_STATUS.CANCELLED,
      mode: OFFER_MODE.AUTO,
      rank: 1,
      etaSeconds: 240,
      expiresAt: expiresAt.toISOString(),
    });
  });

  it('leaves alone an offer the driver answered meanwhile', async () => {
    const { service, prisma, realtime } = setup({
      live: [],
      offers: [{ id: 'offer-1', orderId: 'order-1', driverId: 'd7' }],
    });
    prisma.driverOffer.updateMany.mockResolvedValue({ count: 0 });

    await service.cancel(operator, 'order-1', dto);

    expect(realtime.emitOfferUpdated).not.toHaveBeenCalled();
  });

  it('still answers when closing the offers fails', async () => {
    const { service, prisma, realtime } = setup({ live: [] });
    prisma.driverOffer.findMany.mockRejectedValue(new Error('db down'));

    await expect(
      service.cancel(operator, 'order-1', dto),
    ).resolves.toMatchObject({ id: 'order-1' });
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalled();
  });
});

describe('OrdersService.updateStatus', () => {
  it('releases the driver when the operator cancels', async () => {
    const { service, tx, realtime } = setup();

    await service.updateStatus(operator, 'order-1', {
      status: STATUS_ORDERS.CANCELLED,
    });

    expectDriversReleased(tx);
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.CANCELLED,
        previousStatus: STATUS_ORDERS.ACCEPTED,
        driverIds: ['d1'],
      }),
    );
  });

  it('releases the driver who marks the trip FAILED', async () => {
    const { service, prisma, tx, realtime } = setup({
      status: STATUS_ORDERS.IN_PROGRESS,
    });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.FAILED,
    });

    expectDriversReleased(tx);
    expect(prisma.driverOffer.findMany).toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.FAILED,
        driverIds: ['d1'],
      }),
    );
  });

  it('leaves assignments and tracking alone while the trip goes on', async () => {
    const { service, prisma, tx, realtime } = setup({
      reread: [
        { driverId: 'd1', assignmentStatus: ASSIGNMENT_STATUS.ACCEPTED },
        { driverId: 'd0', assignmentStatus: ASSIGNMENT_STATUS.REJECTED },
      ],
    });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.IN_PROGRESS,
    });

    expect(tx.orderAssignment.findMany).not.toHaveBeenCalled();
    expect(tx.orderAssignment.updateMany).not.toHaveBeenCalled();
    expect(tx.trackingSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.driverOffer.findMany).not.toHaveBeenCalled();
    // Solo el conductor con la asignacion viva, no el que la rechazo.
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.IN_PROGRESS,
        driverIds: ['d1'],
      }),
    );
  });

  it('tells the driver whose assignment a delivery completes', async () => {
    const { service, tx, realtime } = setup({
      status: STATUS_ORDERS.IN_PROGRESS,
      reread: [
        { driverId: 'd1', assignmentStatus: ASSIGNMENT_STATUS.COMPLETED },
      ],
    });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.DELIVERED,
    });

    expect(tx.orderAssignment.update).toHaveBeenCalledWith({
      where: { id: 'asg-1' },
      data: { assignmentStatus: ASSIGNMENT_STATUS.COMPLETED },
    });
    expect(tx.trackingSession.updateMany).not.toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.DELIVERED,
        driverIds: ['d1'],
      }),
    );
  });
});

describe('OrdersService.confirmByCustomer', () => {
  it('announces the confirmation to the drivers of the order, if any', async () => {
    const { service, realtime } = setup({ reread: [] });

    await service.confirmByCustomer(customerUser, 'order-1');

    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        status: STATUS_ORDERS.PENDING_PAYMENT,
        previousStatus: STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
        driverIds: [],
      }),
    );
  });
});
