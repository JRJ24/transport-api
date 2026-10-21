import { STATUS_ORDERS } from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import type { RealtimeService } from '@/modules/realtime/realtime.service';
import { TripsService } from './trips.service';

const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;
const dto = { orderId: 'order-1', driverId: 'd1' };

function setup(orderStatus: STATUS_ORDERS) {
  const tx = {
    transportOrder: {
      updateMany: jest.fn().mockResolvedValue({
        count: orderStatus === STATUS_ORDERS.ACCEPTED ? 1 : 0,
      }),
      findUnique: jest.fn().mockResolvedValue({ status: orderStatus }),
    },
    trackingSession: {
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const realtime = { emitTripEvent: jest.fn() };
  const service = new TripsService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeService,
  );
  return { service, tx, realtime };
}

describe('TripsService.start (LOG-API-008)', () => {
  it('starts the trip of an ACCEPTED order', async () => {
    const { service, tx } = setup(STATUS_ORDERS.ACCEPTED);

    await service.start(operator, dto as never);

    expect(tx.transportOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: STATUS_ORDERS.ACCEPTED },
      data: {
        status: STATUS_ORDERS.IN_PROGRESS,
        pickupAt: expect.any(Date) as unknown,
      },
    });
    expect(tx.trackingSession.create).toHaveBeenCalled();
  });

  it('resumes tracking on an order already in progress', async () => {
    const { service, tx } = setup(STATUS_ORDERS.IN_PROGRESS);

    await service.start(operator, dto as never);

    expect(tx.trackingSession.create).toHaveBeenCalled();
  });

  it.each([
    STATUS_ORDERS.CANCELLED,
    STATUS_ORDERS.DELIVERED,
    STATUS_ORDERS.FAILED,
    STATUS_ORDERS.REQUESTED,
  ])('never puts a %s order back on the road', async (status) => {
    const { service, tx, realtime } = setup(status);

    await expect(service.start(operator, dto as never)).rejects.toMatchObject({
      status: 409,
    });
    expect(tx.trackingSession.create).not.toHaveBeenCalled();
    expect(realtime.emitTripEvent).not.toHaveBeenCalled();
  });
});
