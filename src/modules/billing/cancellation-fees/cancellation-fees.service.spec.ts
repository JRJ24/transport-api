import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import type { PricingService } from '@/modules/transport/pricing/pricing.service';
import { CancellationFeesService } from './cancellation-fees.service';

const customer = { id: 'user-c1', roles: ['CUSTOMER'] } as AuthenticatedUser;
const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;

function setup(
  status: STATUS_ORDERS,
  ruleFee = 150,
  reservations: { cancellationDeadline: Date }[] = [],
) {
  const prisma = {
    transportOrder: {
      findUnique: jest.fn().mockResolvedValue({
        status,
        vehicleCategoryId: 'cat-1',
        quote: { breakdown: { rateRuleId: 'rule-1' } },
        payments: [
          {
            amount: 1000,
            paymentMethod: PAYMENT_METHOD.CARD,
            status: PAYMENT_STATUS.PAID,
          },
        ],
        reservations,
      }),
    },
  };
  const pricing = { cancellationFeeFor: jest.fn().mockResolvedValue(ruleFee) };
  const service = new CancellationFeesService(
    prisma as unknown as PrismaService,
    pricing as unknown as PricingService,
  );
  return { service };
}

describe('CancellationFeesService (LOG-API-007)', () => {
  it('shows the same rate-rule fee the cancellation keeps', async () => {
    const { service } = setup(STATUS_ORDERS.ACCEPTED);

    await expect(service.calculate('order-1', customer)).resolves.toEqual({
      orderId: 'order-1',
      cancellable: true,
      feeApplied: true,
      feeAmount: 150,
      refundAmount: 850,
      freeCancellationUntil: null,
      provider: 'rate-rule',
    });
  });

  // LOG-API-009: a scheduled order has no driver until minutes before pickup.
  it('a scheduled order past its cancellation deadline shows the fee', async () => {
    const deadline = new Date(Date.now() - 5 * 60_000);
    const { service } = setup(STATUS_ORDERS.REQUESTED, 150, [
      { cancellationDeadline: deadline },
    ]);

    await expect(service.calculate('order-1', customer)).resolves.toMatchObject(
      {
        feeApplied: true,
        feeAmount: 150,
        refundAmount: 850,
        freeCancellationUntil: deadline,
      },
    );
  });

  it('a scheduled order before its deadline is still free to cancel', async () => {
    const deadline = new Date(Date.now() + 24 * 60 * 60_000);
    const { service } = setup(STATUS_ORDERS.REQUESTED, 150, [
      { cancellationDeadline: deadline },
    ]);

    await expect(service.calculate('order-1', customer)).resolves.toMatchObject(
      { feeAmount: 0, refundAmount: 1000, freeCancellationUntil: deadline },
    );
  });

  it('shows no fee before a driver is committed', async () => {
    const { service } = setup(STATUS_ORDERS.REQUESTED);

    await expect(service.calculate('order-1', customer)).resolves.toMatchObject(
      { cancellable: true, feeAmount: 0, refundAmount: 1000 },
    );
  });

  it('tells the customer an order in progress is not theirs to cancel', async () => {
    const { service } = setup(STATUS_ORDERS.IN_PROGRESS);

    await expect(service.calculate('order-1', customer)).resolves.toMatchObject(
      { cancellable: false, feeAmount: 0, refundAmount: 0 },
    );
    await expect(service.calculate('order-1', operator)).resolves.toMatchObject(
      { cancellable: true, feeAmount: 150 },
    );
  });

  it('nobody can cancel a delivered order', async () => {
    const { service } = setup(STATUS_ORDERS.DELIVERED);

    await expect(service.calculate('order-1', operator)).resolves.toMatchObject(
      { cancellable: false, feeApplied: false },
    );
  });
});
