import {
  ORDER_CANCELLATION,
  RESERVATIONS_STATUS,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import type { OrdersService } from '../orders/orders.service';
import { ReservationsService } from './reservations.service';

const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;

function setup(orderStatus: STATUS_ORDERS | null) {
  const tx = {
    reservation: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ reservationStatus: RESERVATIONS_STATUS.ACTIVE }),
      update: jest.fn().mockResolvedValue({
        id: 'res-1',
        reservationStatus: RESERVATIONS_STATUS.CANCELLED,
      }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    reservation: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          orderStatus
            ? { orderId: 'order-1', order: { status: orderStatus } }
            : null,
        ),
    },
  };
  const orders = { cancel: jest.fn().mockResolvedValue({}) };
  const service = new ReservationsService(
    prisma as unknown as PrismaService,
    orders as unknown as OrdersService,
  );
  return { service, orders, tx };
}

describe('ReservationsService.cancel (LOG-API-008)', () => {
  it('cancels and settles the open order behind the reservation', async () => {
    const { service, orders, tx } = setup(STATUS_ORDERS.REQUESTED);

    await service.cancel('res-1', operator, { reason: 'Cliente pospuso' });

    expect(orders.cancel).toHaveBeenCalledWith(operator, 'order-1', {
      cancellationType: ORDER_CANCELLATION.ADMIN_CANCELLED,
      reason: 'Cliente pospuso',
    });
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { reservationStatus: RESERVATIONS_STATUS.CANCELLED },
    });
  });

  it('uses a default reason when the portal sends none', async () => {
    const { service, orders } = setup(STATUS_ORDERS.REQUESTED);

    await service.cancel('res-1', operator);

    expect(orders.cancel).toHaveBeenCalledWith(
      operator,
      'order-1',
      expect.objectContaining({
        reason: 'Reservation cancelled by operations',
      }),
    );
  });

  it.each([
    STATUS_ORDERS.DELIVERED,
    STATUS_ORDERS.FAILED,
    STATUS_ORDERS.CANCELLED,
  ])('only closes the reservation of a %s order', async (status) => {
    const { service, orders, tx } = setup(status);

    await service.cancel('res-1', operator);

    expect(orders.cancel).not.toHaveBeenCalled();
    expect(tx.reservation.update).toHaveBeenCalled();
  });

  it('answers 404 for an unknown reservation', async () => {
    const { service, orders } = setup(null);

    await expect(service.cancel('res-x', operator)).rejects.toMatchObject({
      status: 404,
    });
    expect(orders.cancel).not.toHaveBeenCalled();
  });
});
