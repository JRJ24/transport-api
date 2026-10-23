import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  PAYMENTS_REFUND_STATUS,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import type { ConfigType } from '@nestjs/config';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { paymentConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import type { DispatchTriggerService } from '@/modules/operations/offers/dispatch-trigger.service';
import type { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import type { CardnetGateway } from './cardnet.gateway';
import { PaymentsService } from './payments.service';
import type { PaymentProviderRegistry } from './providers/payment-provider.registry';

const customer = { id: 'user-c1', roles: ['CUSTOMER'] } as AuthenticatedUser;
const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;

interface OtherPayment {
  amount: number;
  paymentMethod: PAYMENT_METHOD;
  status: PAYMENT_STATUS;
}

function setup(
  orderStatus: STATUS_ORDERS,
  options: { otherPayments?: OtherPayment[] } = {},
) {
  const otherPayments = options.otherPayments ?? [];
  const order = {
    id: 'order-1',
    orderCode: 'ORD-1',
    customerId: 'cust-1',
    status: orderStatus,
    paymentStatus: PAYMENT_STATUS.PENDING,
    totalAmount: 1000,
    customer: { user: { id: 'user-c1' } },
    payments: [] as OtherPayment[],
  };
  const pendingCardnet = {
    id: 'pay-1',
    orderId: 'order-1',
    amount: 1000,
    currency: 'DOP',
    status: PAYMENT_STATUS.PROCESSING,
    paymentMethod: PAYMENT_METHOD.CARD,
    paymentProvider: 'cardnet',
    providerSessionId: 'sess-1',
    providerSessionKey: 'sk-1',
    transactionId: '000123',
    expiresAt: new Date(Date.now() + 10 * 60_000),
    order: { ...order },
    paymentsTransactions: [],
  };

  // The payment row as the database holds it. The conditional updateMany
  // only writes while it is not settled, like `status: { notIn: [...] }`.
  const row: Record<string, unknown> = { ...pendingCardnet };
  const tx = {
    payment: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { status: { notIn: PAYMENT_STATUS[] } };
          data: Record<string, unknown>;
        }) => {
          if (where.status.notIn.includes(row.status as PAYMENT_STATUS)) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        },
      ),
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...row })),
    },
    paymentTransaction: { create: jest.fn().mockResolvedValue({}) },
    // rejectedCaptureReason asks for the other payments; syncOrderAfterPayment
    // for all of them, including the capture just marked PAID.
    transportOrder: {
      findUnique: jest.fn(
        ({ select }: { select: { payments: { where?: unknown } } }) =>
          Promise.resolve({
            status: orderStatus,
            totalAmount: 1000,
            payments: select.payments.where
              ? otherPayments
              : [
                  ...otherPayments,
                  {
                    amount: 1000,
                    paymentMethod: PAYMENT_METHOD.CARD,
                    status: PAYMENT_STATUS.PAID,
                  },
                ],
          }),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    refund: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    transportOrder: {
      findFirst: jest.fn().mockResolvedValue({
        ...order,
        payments: [pendingCardnet],
      }),
      findUnique: jest.fn().mockResolvedValue(order),
    },
    payment: {
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(pendingCardnet),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-op' }]) },
  };
  const gateway = {
    createSession: jest.fn(),
    getResult: jest.fn().mockResolvedValue({
      ResponseCode: '00',
      OrdenID: 'ORD-1',
      TransactionID: '000123',
    }),
  };
  const notifications = { dispatch: jest.fn().mockResolvedValue({}) };
  const dispatchTrigger = { orderMaybeDispatchable: jest.fn() };

  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    {} as PaymentProviderRegistry,
    gateway as unknown as CardnetGateway,
    { cardnetAuthorizeUrl: 'https://cardnet.test/authorize' } as ConfigType<
      typeof paymentConfig
    >,
    dispatchTrigger as unknown as DispatchTriggerService,
    notifications as unknown as NotificationDispatcherService,
  );

  return {
    service,
    prisma,
    tx,
    row,
    pendingCardnet,
    gateway,
    notifications,
    dispatchTrigger,
  };
}

describe('PaymentsService order status guard (LOG-API-001)', () => {
  it.each([
    STATUS_ORDERS.CANCELLED,
    STATUS_ORDERS.FAILED,
    STATUS_ORDERS.DELIVERED,
    STATUS_ORDERS.PENDING_QUOTE,
  ])('refuses a CardNET session for a %s order', async (status) => {
    const { service, prisma, gateway } = setup(status);

    await expect(
      service.createCardnetSession('order-1', customer, '127.0.0.1'),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(gateway.createSession).not.toHaveBeenCalled();
  });

  it('does not hand out a still-open session once the order is cancelled', async () => {
    const { service } = setup(STATUS_ORDERS.CANCELLED);

    // The order carries a live PROCESSING session that would otherwise be
    // reused as is.
    await expect(
      service.createCardnetSession('order-1', customer, '127.0.0.1'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('still reuses the open session while the order is payable', async () => {
    const { service, prisma } = setup(STATUS_ORDERS.PENDING_PAYMENT);

    const result = await service.createCardnetSession(
      'order-1',
      customer,
      '127.0.0.1',
    );

    expect(result.session).toBe('sess-1');
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('refuses customer corporate credit on a cancelled order', async () => {
    const { service, prisma } = setup(STATUS_ORDERS.CANCELLED);
    prisma.transportOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      orderCode: 'ORD-1',
      status: STATUS_ORDERS.CANCELLED,
      paymentStatus: PAYMENT_STATUS.PENDING,
      totalAmount: 1000,
      payments: [],
      customer: {
        customerType: 'BUSINESS',
        user: { id: 'user-c1' },
        creditAccount: {
          id: 'credit-1',
          status: 'ACTIVE',
          creditLimit: 50_000,
          balanceUsed: 0,
        },
      },
    });

    await expect(
      service.approveCorporateCredit({ orderId: 'order-1' }, customer),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a check on a failed order, even from staff', async () => {
    const { service, prisma } = setup(STATUS_ORDERS.FAILED);
    prisma.transportOrder.findUnique.mockResolvedValue({
      id: 'order-1',
      status: STATUS_ORDERS.FAILED,
      paymentStatus: PAYMENT_STATUS.PENDING,
      totalAmount: 1000,
      payments: [],
    });

    await expect(
      service.registerCheck(
        { orderId: 'order-1', bankName: 'BHD', checkNumber: '0001' },
        operator,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PaymentsService CardNET capture on an order that cannot take it', () => {
  it('keeps the money as PAID, leaves the cancelled order alone and asks for a refund', async () => {
    const { service, tx, notifications, dispatchTrigger } = setup(
      STATUS_ORDERS.CANCELLED,
    );

    const receipt = await service.verifyCardnetPaymentBySession('sess-1');

    expect(receipt.status).toBe(PAYMENT_STATUS.PAID);
    expect(tx.transportOrder.update).not.toHaveBeenCalled();
    expect(dispatchTrigger.orderMaybeDispatchable).not.toHaveBeenCalled();
    expect(tx.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: 'pay-1',
        orderId: 'order-1',
        amount: 1000,
        status: PAYMENTS_REFUND_STATUS.PENDING,
      }) as unknown,
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(notifications.dispatch).toHaveBeenCalledWith(
      'user-op',
      'OPERATOR_MESSAGE',
      expect.objectContaining({ orderCode: 'ORD-1' }),
    );
  });

  it('asks for a refund when another payment already covered the order', async () => {
    const { service, tx } = setup(STATUS_ORDERS.PENDING_PAYMENT, {
      otherPayments: [
        {
          amount: 1000,
          paymentMethod: PAYMENT_METHOD.CORPORATE_CREDIT,
          status: PAYMENT_STATUS.AUTHORIZED,
        },
      ],
    });

    await service.verifyCardnetPaymentBySession('sess-1');

    expect(tx.refund.create).toHaveBeenCalled();
    expect(tx.transportOrder.update).not.toHaveBeenCalled();
  });

  it('does not open a second refund for the same capture', async () => {
    const { service, tx } = setup(STATUS_ORDERS.CANCELLED);
    tx.refund.findFirst.mockResolvedValue({ id: 'refund-1' });

    await service.verifyCardnetPaymentBySession('sess-1');

    expect(tx.refund.create).not.toHaveBeenCalled();
  });

  it('applies a normal capture to a payable order and dispatches it', async () => {
    const { service, tx, dispatchTrigger } = setup(
      STATUS_ORDERS.PENDING_PAYMENT,
    );

    await service.verifyCardnetPaymentBySession('sess-1');

    expect(tx.refund.create).not.toHaveBeenCalled();
    // Paid in full by card is PAID, not AUTHORIZED.
    expect(tx.transportOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        paymentStatus: PAYMENT_STATUS.PAID,
        status: STATUS_ORDERS.REQUESTED,
      },
    });
    expect(dispatchTrigger.orderMaybeDispatchable).toHaveBeenCalledWith(
      'order-1',
    );
  });

  it('stays AUTHORIZED while part of the total is uncollected corporate credit', async () => {
    const { service, tx } = setup(STATUS_ORDERS.PENDING_PAYMENT, {
      otherPayments: [
        {
          amount: 500,
          paymentMethod: PAYMENT_METHOD.CORPORATE_CREDIT,
          status: PAYMENT_STATUS.AUTHORIZED,
        },
      ],
    });

    await service.verifyCardnetPaymentBySession('sess-1');

    expect(tx.refund.create).not.toHaveBeenCalled();
    expect(tx.transportOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: {
        paymentStatus: PAYMENT_STATUS.AUTHORIZED,
        status: STATUS_ORDERS.REQUESTED,
      },
    });
  });
});

describe('PaymentsService settled CardNET payments (LOG-API-002)', () => {
  it('never re-verifies a refunded payment back to PAID', async () => {
    const { service, prisma, tx, gateway, dispatchTrigger, pendingCardnet } =
      setup(STATUS_ORDERS.REQUESTED);
    prisma.payment.findUnique.mockResolvedValue({
      ...pendingCardnet,
      status: PAYMENT_STATUS.REFUNDED,
    });

    const receipt = await service.verifyCardnetPaymentBySession('sess-1');

    expect(receipt.status).toBe(PAYMENT_STATUS.REFUNDED);
    expect(gateway.getResult).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(dispatchTrigger.orderMaybeDispatchable).not.toHaveBeenCalled();
  });

  it('leaves a payment another request settled meanwhile untouched', async () => {
    const { service, tx, row, gateway } = setup(STATUS_ORDERS.PENDING_PAYMENT);
    // The webhook read PROCESSING, but the return URL marked it PAID before
    // this late, stale CardNET answer was written.
    gateway.getResult.mockImplementation(() => {
      row.status = PAYMENT_STATUS.PAID;
      return Promise.resolve({ ResponseCode: '05', OrdenID: 'ORD-1' });
    });

    const receipt = await service.verifyCardnetPaymentBySession('sess-1');

    expect(receipt.status).toBe(PAYMENT_STATUS.PAID);
    expect(row.status).toBe(PAYMENT_STATUS.PAID);
    expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
    expect(tx.transportOrder.update).not.toHaveBeenCalled();
  });

  it('captures once when the return URL and /verify settle the same payment at once (FIA-API-003)', async () => {
    const { service, tx, row, dispatchTrigger } = setup(
      STATUS_ORDERS.PENDING_PAYMENT,
    );

    // Both requests read the payment while it is still PROCESSING and both
    // get '00' from CardNET; only the first conditional write may win.
    const receipts = await Promise.all([
      service.verifyCardnetPaymentBySession('sess-1'),
      service.verifyCardnetPaymentBySession('sess-1'),
    ]);

    expect(receipts.map((receipt) => receipt.status)).toEqual([
      PAYMENT_STATUS.PAID,
      PAYMENT_STATUS.PAID,
    ]);
    expect(row.status).toBe(PAYMENT_STATUS.PAID);
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.paymentTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.transportOrder.update).toHaveBeenCalledTimes(1);
    expect(dispatchTrigger.orderMaybeDispatchable).toHaveBeenCalledTimes(1);
  });

  it('does not let a late cancel redirect turn PAID into CANCELLED', async () => {
    const { service, prisma, tx, row } = setup(STATUS_ORDERS.PENDING_PAYMENT);
    // The cancel read the payment while it was still PROCESSING...
    prisma.payment.findUnique.mockImplementation(() => {
      const snapshot = { ...row };
      // ...and the webhook confirmed the charge right after.
      row.status = PAYMENT_STATUS.PAID;
      return Promise.resolve(snapshot);
    });

    const receipt = await service.cancelCardnetPaymentBySession('sess-1');

    expect(receipt?.status).toBe(PAYMENT_STATUS.PAID);
    expect(row.status).toBe(PAYMENT_STATUS.PAID);
    expect(tx.transportOrder.update).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('does not cancel a refunded payment', async () => {
    const { service, prisma, tx, pendingCardnet } = setup(
      STATUS_ORDERS.CANCELLED,
    );
    prisma.payment.findUnique.mockResolvedValue({
      ...pendingCardnet,
      status: PAYMENT_STATUS.REFUNDED,
    });

    const receipt = await service.cancelCardnetPaymentBySession('sess-1');

    expect(receipt?.status).toBe(PAYMENT_STATUS.REFUNDED);
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it('a declined attempt does not undo an order another payment covers', async () => {
    const { service, tx, gateway } = setup(STATUS_ORDERS.REQUESTED, {
      otherPayments: [
        {
          amount: 1000,
          paymentMethod: PAYMENT_METHOD.CARD,
          status: PAYMENT_STATUS.PAID,
        },
      ],
    });
    gateway.getResult.mockResolvedValue({
      ResponseCode: '05',
      OrdenID: 'ORD-1',
    });

    await service.verifyCardnetPaymentBySession('sess-1');

    // syncOrderAfterPayment recomputes from every payment: still PAID.
    expect(tx.transportOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { paymentStatus: PAYMENT_STATUS.PAID },
    });
  });
});
