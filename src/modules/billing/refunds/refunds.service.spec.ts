import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  PAYMENTS_REFUND_STATUS,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import { RefundsService } from './refunds.service';

const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;

function setup(
  options: {
    refundStatus?: PAYMENTS_REFUND_STATUS;
    paymentAmount?: number;
    successfulRefunds?: number[];
    orderStatus?: STATUS_ORDERS;
    orderPayments?: { status: PAYMENT_STATUS; paymentMethod: PAYMENT_METHOD }[];
  } = {},
) {
  const row = {
    id: 'refund-1',
    paymentId: 'pay-1',
    orderId: 'order-1',
    amount: 850,
    status: options.refundStatus ?? PAYMENTS_REFUND_STATUS.PENDING,
  };
  const tx = {
    refund: {
      updateMany: jest.fn(() =>
        Promise.resolve({
          count: row.status === PAYMENTS_REFUND_STATUS.PENDING ? 1 : 0,
        }),
      ),
      findUnique: jest.fn(() => Promise.resolve({ status: row.status })),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(row)),
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve({ id: 'refund-new', ...data }),
      ),
    },
    paymentTransaction: { create: jest.fn().mockResolvedValue({}) },
    payment: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        amount: options.paymentAmount ?? 850,
        refunds: (options.successfulRefunds ?? [850]).map((amount) => ({
          amount,
        })),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    transportOrder: {
      findUnique: jest.fn().mockResolvedValue({
        status: options.orderStatus ?? STATUS_ORDERS.CANCELLED,
        payments: options.orderPayments ?? [
          {
            status: PAYMENT_STATUS.REFUNDED,
            paymentMethod: PAYMENT_METHOD.CARD,
          },
        ],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const service = new RefundsService(prisma as unknown as PrismaService);
  return { service, tx };
}

describe('RefundsService.updateStatus', () => {
  it('confirms a refund: books it, closes the payment and the cancelled order', async () => {
    const { service, tx } = setup();

    await service.updateStatus(
      'refund-1',
      { status: PAYMENTS_REFUND_STATUS.SUCCESS, providerReference: 'CN-889' },
      operator,
    );

    expect(tx.refund.updateMany).toHaveBeenCalledWith({
      where: { id: 'refund-1', status: PAYMENTS_REFUND_STATUS.PENDING },
      data: {
        status: PAYMENTS_REFUND_STATUS.SUCCESS,
        providerReference: 'CN-889',
      },
    });
    expect(tx.paymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: 'pay-1',
        transactionType: 'REFUND',
        amount: 850,
      }) as unknown,
    });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-1' },
      data: { status: PAYMENT_STATUS.REFUNDED },
    });
    expect(tx.transportOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { paymentStatus: PAYMENT_STATUS.REFUNDED },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'user-op',
        action: 'REFUND_COMPLETED',
        entityId: 'refund-1',
      }) as unknown,
    });
  });

  it('a partial refund leaves the payment PAID', async () => {
    const { service, tx } = setup({
      paymentAmount: 1000,
      successfulRefunds: [850],
      orderPayments: [
        { status: PAYMENT_STATUS.PAID, paymentMethod: PAYMENT_METHOD.CARD },
      ],
    });

    await service.updateStatus(
      'refund-1',
      { status: PAYMENTS_REFUND_STATUS.SUCCESS, providerReference: 'CN-1' },
      operator,
    );

    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.transportOrder.update).not.toHaveBeenCalled();
  });

  it('requires the provider reference to confirm', async () => {
    const { service, tx } = setup();

    await expect(
      service.updateStatus(
        'refund-1',
        { status: PAYMENTS_REFUND_STATUS.SUCCESS, providerReference: '  ' },
        operator,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.refund.updateMany).not.toHaveBeenCalled();
  });

  it.each([PAYMENTS_REFUND_STATUS.SUCCESS, PAYMENTS_REFUND_STATUS.FAILED])(
    'a %s refund cannot be decided again',
    async (refundStatus) => {
      const { service, tx } = setup({ refundStatus });

      await expect(
        service.updateStatus(
          'refund-1',
          { status: PAYMENTS_REFUND_STATUS.SUCCESS, providerReference: 'X-1' },
          operator,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
    },
  );

  it('cannot be put back to PENDING', async () => {
    const { service } = setup();

    await expect(
      service.updateStatus(
        'refund-1',
        { status: PAYMENTS_REFUND_STATUS.PENDING },
        operator,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('a failed refund touches neither payment nor order', async () => {
    const { service, tx } = setup();

    await service.updateStatus(
      'refund-1',
      { status: PAYMENTS_REFUND_STATUS.FAILED },
      operator,
    );

    expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'REFUND_FAILED' }) as unknown,
    });
  });
});

describe('RefundsService.create', () => {
  function withPayment(payment: Record<string, unknown>) {
    const ctx = setup();
    ctx.tx.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      orderId: 'order-1',
      amount: 1000,
      paymentMethod: PAYMENT_METHOD.CARD,
      status: PAYMENT_STATUS.PAID,
      refunds: [],
      ...payment,
    });
    return ctx;
  }

  it('never refunds more than the payment still holds', async () => {
    const { service, tx } = withPayment({ refunds: [{ amount: 850 }] });

    await expect(
      service.create(
        { paymentId: 'pay-1', amount: 200, reason: 'Ajuste' },
        operator,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.refund.create).not.toHaveBeenCalled();

    await service.create(
      { paymentId: 'pay-1', amount: 150, reason: 'Ajuste' },
      operator,
    );
    expect(tx.refund.create).toHaveBeenCalled();
  });

  it('refuses a cash refund of corporate credit', async () => {
    const { service, tx } = withPayment({
      paymentMethod: PAYMENT_METHOD.CORPORATE_CREDIT,
      status: PAYMENT_STATUS.AUTHORIZED,
    });

    await expect(
      service.create(
        { paymentId: 'pay-1', amount: 100, reason: 'Ajuste' },
        operator,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.refund.create).not.toHaveBeenCalled();
  });

  it('refuses a payment that holds no money', async () => {
    const { service } = withPayment({ status: PAYMENT_STATUS.FAILED });

    await expect(
      service.create(
        { paymentId: 'pay-1', amount: 100, reason: 'Ajuste' },
        operator,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
