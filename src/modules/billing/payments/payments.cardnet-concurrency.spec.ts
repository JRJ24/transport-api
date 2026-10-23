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
import type { CardnetGateway } from './cardnet.gateway';
import { PaymentsService } from './payments.service';
import type { PaymentProviderRegistry } from './providers/payment-provider.registry';

const customer = { id: 'user-c1', roles: ['CUSTOMER'] } as AuthenticatedUser;

/** Lets other pending requests run, like a round trip to Postgres. */
const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

interface FakePayment {
  id: string;
  orderId: string;
  customerId: string;
  amount: number;
  currency: string;
  paymentMethod: PAYMENT_METHOD;
  paymentProvider: string;
  status: PAYMENT_STATUS;
  transactionId: string | null;
  providerReference: string | null;
  providerSessionId: string | null;
  providerSessionKey: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  [field: string]: unknown;
}

type Where = Record<string, unknown>;

/** Enough of Prisma's `where` for the payment queries in this flow. */
function matches(payment: FakePayment, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = payment[key];
    if (condition === null) return value === null || value === undefined;
    if (typeof condition === 'object' && condition !== null) {
      const c = condition as {
        in?: unknown[];
        notIn?: unknown[];
        not?: unknown;
      };
      if (c.in) return c.in.includes(value);
      if (c.notIn) return !c.notIn.includes(value);
      if ('not' in c) return value !== c.not;
    }
    return value === condition;
  });
}

/**
 * In-memory Postgres stand-in with the two properties these races depend on:
 * READ COMMITTED (a transaction only sees committed rows plus its own writes)
 * and `SELECT … FOR UPDATE` (tx.$queryRaw) holding a per-order lock until the
 * transaction ends.
 */
function createFakeDb(seed: Partial<FakePayment>[] = []) {
  const order = {
    id: 'order-1',
    orderCode: 'ORD-1',
    customerId: 'cust-1',
    status: STATUS_ORDERS.PENDING_PAYMENT as STATUS_ORDERS,
    paymentStatus: PAYMENT_STATUS.PENDING as PAYMENT_STATUS,
    totalAmount: 5000,
  };
  let nextId = 0;
  const newPayment = (data: Partial<FakePayment>): FakePayment => ({
    id: `pay-${++nextId}`,
    orderId: order.id,
    customerId: order.customerId,
    amount: 5000,
    currency: 'DOP',
    paymentMethod: PAYMENT_METHOD.CARD,
    paymentProvider: 'cardnet',
    status: PAYMENT_STATUS.PENDING,
    transactionId: null,
    providerReference: null,
    providerSessionId: null,
    providerSessionKey: null,
    expiresAt: null,
    createdAt: new Date(),
    ...data,
  });
  const committed = new Map<string, FakePayment>(
    seed.map((data) => {
      const payment = newPayment(data);
      return [payment.id, payment];
    }),
  );
  const refunds: { paymentId: string }[] = [];
  const captures: { paymentId: string; status: string }[] = [];
  const locks = new Map<string, Promise<void>>();

  const orderView = (payments: FakePayment[]) => ({
    ...order,
    customer: {
      userId: customer.id,
      billingEmail: 'c1@x.com',
      user: { id: customer.id, email: 'c1@x.com', phone: '8095550000' },
      customerAddresses: [],
    },
    orderStops: [],
    payments: payments.map((payment) => ({ ...payment })),
  });

  /** A view over the committed rows plus one transaction's own writes. */
  function scope(own?: Map<string, FakePayment>) {
    const rows = () =>
      [...committed.values()]
        .map((payment) => own?.get(payment.id) ?? payment)
        .concat([...(own?.values() ?? [])].filter((p) => !committed.has(p.id)));
    const write = (payment: FakePayment) =>
      own ? own.set(payment.id, payment) : committed.set(payment.id, payment);

    return {
      payment: {
        findFirst: async ({ where }: { where: Where }) => {
          await yieldTurn();
          return rows().find((payment) => matches(payment, where)) ?? null;
        },
        findMany: async ({ where }: { where: Where }) => {
          await yieldTurn();
          return rows().filter((payment) => matches(payment, where));
        },
        findUnique: async ({ where }: { where: Where }) => {
          await yieldTurn();
          const payment = rows().find((p) => matches(p, where));
          if (!payment) return null;
          return {
            ...payment,
            order: orderView(rows()),
            paymentsTransactions: [],
          };
        },
        findUniqueOrThrow: async ({ where }: { where: Where }) => {
          await yieldTurn();
          return { ...rows().find((payment) => matches(payment, where))! };
        },
        create: async ({ data }: { data: Partial<FakePayment> }) => {
          await yieldTurn();
          const payment = newPayment(data);
          write(payment);
          return { ...payment };
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<FakePayment>;
        }) => {
          await yieldTurn();
          const payment = {
            ...rows().find((p) => p.id === where.id)!,
            ...data,
          };
          write(payment);
          return { ...payment };
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: Where;
          data: Partial<FakePayment>;
        }) => {
          await yieldTurn();
          const hits = rows().filter((payment) => matches(payment, where));
          hits.forEach((payment) => write({ ...payment, ...data }));
          return { count: hits.length };
        },
      },
      transportOrder: {
        findFirst: async () => {
          await yieldTurn();
          return orderView(rows());
        },
        findUnique: async ({
          select,
        }: {
          select?: { payments?: { where?: { id?: { not?: string } } } };
        }) => {
          await yieldTurn();
          const excluded = select?.payments?.where?.id?.not;
          return orderView(rows().filter((payment) => payment.id !== excluded));
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          await yieldTurn();
          Object.assign(order, data);
          return { ...order };
        },
      },
      paymentTransaction: {
        create: async ({
          data,
        }: {
          data: { paymentId: string; status: string };
        }) => {
          await yieldTurn();
          captures.push(data);
          return data;
        },
      },
      refund: {
        findFirst: async ({ where }: { where: { paymentId: string } }) => {
          await yieldTurn();
          return (
            refunds.find((refund) => refund.paymentId === where.paymentId) ??
            null
          );
        },
        create: async ({ data }: { data: { paymentId: string } }) => {
          await yieldTurn();
          refunds.push(data);
          return data;
        },
      },
    };
  }

  const prisma = {
    ...scope(),
    $transaction: async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const own = new Map<string, FakePayment>();
      const held: (() => void)[] = [];
      const tx = {
        ...scope(own),
        $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
          const orderId = String(values[0]);
          const previous = locks.get(orderId) ?? Promise.resolve();
          let release!: () => void;
          const mine = new Promise<void>((resolve) => (release = resolve));
          locks.set(
            orderId,
            previous.then(() => mine),
          );
          await previous;
          held.push(release);
          return [{ id: orderId, sql: sql.join('?') }];
        },
      };
      try {
        const result = await (arg as (client: unknown) => Promise<unknown>)(tx);
        own.forEach((payment) => committed.set(payment.id, payment)); // COMMIT
        return result;
      } finally {
        held.forEach((release) => release());
      }
    },
  };

  const gateway = {
    createSession: jest.fn(async () => {
      await yieldTurn();
      return { SESSION: `sess-${Math.random()}`, 'session-key': 'sk' };
    }),
    getResult: jest.fn(async () => {
      await yieldTurn();
      return { ResponseCode: '00', OrdenID: 'ORD-1' };
    }),
  };
  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    {} as PaymentProviderRegistry,
    gateway as unknown as CardnetGateway,
    { cardnetAuthorizeUrl: 'https://cardnet.test/authorize' } as ConfigType<
      typeof paymentConfig
    >,
  );
  // The 3DS payload needs the whole CardNET config; it is not what these
  // tests are about.
  jest
    .spyOn(
      service as unknown as { buildCardnetPayload: () => unknown },
      'buildCardnetPayload',
    )
    .mockReturnValue({});
  const alert = jest
    .spyOn(
      service as unknown as { alertCaptureNeedsRefund: () => void },
      'alertCaptureNeedsRefund',
    )
    .mockImplementation(() => undefined);

  return { service, order, committed, refunds, captures, gateway, alert };
}

const open = (db: ReturnType<typeof createFakeDb>) =>
  db.service.createCardnetSession('order-1', customer, '127.0.0.1');

describe('PaymentsService CardNET sessions under concurrency (FIA-API-002)', () => {
  it('opens one PROCESSING payment with a session (harness sanity)', async () => {
    const db = createFakeDb();

    const result = await open(db);

    const payments = [...db.committed.values()];
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      status: PAYMENT_STATUS.PROCESSING,
      providerSessionId: result.session,
    });
  });

  describe('US1: two session requests at once do not open two sessions', () => {
    it('creates a single payment and CardNET session for simultaneous requests', async () => {
      const db = createFakeDb();

      const results = await Promise.allSettled([open(db), open(db)]);

      expect(db.committed.size).toBe(1);
      expect(db.gateway.createSession).toHaveBeenCalledTimes(1);
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({
            status: 409,
            response: { code: 'RESOURCE_CONFLICT' },
          });
        } else {
          expect(result.value.session).toBe(fulfilled[0].value.session);
        }
      }
    });

    it('releases the order lock while CardNET is creating the session', async () => {
      const db = createFakeDb();
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => (entered = resolve));
      const response = new Promise<void>((resolve) => (release = resolve));
      db.gateway.createSession.mockImplementationOnce(async () => {
        entered();
        await response;
        return { SESSION: 'slow-session', 'session-key': 'sk' };
      });
      const first = open(db);
      await started;
      try {
        await expect(open(db)).rejects.toMatchObject({
          status: 409,
          response: { code: 'RESOURCE_CONFLICT' },
        });
        expect(db.committed.size).toBe(1);
      } finally {
        release();
        await first;
      }
      expect((await open(db)).session).toBe('slow-session');
      expect(db.gateway.createSession).toHaveBeenCalledTimes(1);
    });

    it('discards a payment left half-created more than two minutes ago', async () => {
      const db = createFakeDb([
        {
          status: PAYMENT_STATUS.PENDING,
          createdAt: new Date(Date.now() - 3 * 60_000),
        },
      ]);

      await open(db);

      const statuses = [...db.committed.values()].map((p) => p.status).sort();
      expect(statuses).toEqual(
        [PAYMENT_STATUS.FAILED, PAYMENT_STATUS.PROCESSING].sort(),
      );
      expect(db.gateway.createSession).toHaveBeenCalledTimes(1);
    });

    it('still hands out an open, unexpired session', async () => {
      const db = createFakeDb([
        {
          status: PAYMENT_STATUS.PROCESSING,
          providerSessionId: 'sess-open',
          providerSessionKey: 'sk',
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      ]);

      const result = await open(db);

      expect(result.session).toBe('sess-open');
      expect(db.gateway.createSession).not.toHaveBeenCalled();
    });
  });

  it('sets aside exactly one of two simultaneous approved captures for refund', async () => {
    const db = createFakeDb(
      ['s1', 's2'].map((providerSessionId) => ({
        status: PAYMENT_STATUS.PROCESSING,
        providerSessionId,
        providerSessionKey: 'sk',
      })),
    );

    await Promise.all([
      db.service.verifyCardnetPaymentBySession('s1'),
      db.service.verifyCardnetPaymentBySession('s2'),
    ]);

    expect(db.order.paymentStatus).toBe(PAYMENT_STATUS.PAID);
    expect(db.refunds).toHaveLength(1);
    expect(db.refunds[0]).toMatchObject({
      status: PAYMENTS_REFUND_STATUS.PENDING,
      amount: 5000,
    });
    const applied = [...db.committed.values()].filter(
      (payment) =>
        !db.refunds.some((refund) => refund.paymentId === payment.id),
    );
    expect(applied).toHaveLength(1);
    expect(applied[0].status).toBe(PAYMENT_STATUS.PAID);
    expect(db.alert).toHaveBeenCalledTimes(1);
    expect(db.alert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1' }),
      expect.objectContaining({ id: db.refunds[0].paymentId }),
      expect.any(String),
    );
  });
});
