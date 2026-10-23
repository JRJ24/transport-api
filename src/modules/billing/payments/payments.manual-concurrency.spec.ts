import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
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
const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;

/** Lets other pending requests run, like a network round trip to Postgres. */
const yieldTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

interface FakePayment {
  id: string;
  orderId: string;
  amount: number;
  paymentMethod: PAYMENT_METHOD;
  status: PAYMENT_STATUS;
}

/**
 * In-memory database with the bits of Postgres this race depends on: writes
 * are visible right away and undone on rollback, and `SELECT … FOR UPDATE`
 * (tx.$queryRaw) holds a per-order lock until the transaction ends.
 */
function createFakeDb(orderTotals: Record<string, number>) {
  const orders = new Map(
    Object.entries(orderTotals).map(([id, total]) => [
      id,
      {
        id,
        orderCode: `ORD-${id}`,
        customerId: 'cust-1',
        status: STATUS_ORDERS.PENDING_PAYMENT,
        paymentStatus: PAYMENT_STATUS.PENDING as PAYMENT_STATUS,
        totalAmount: total,
      },
    ]),
  );
  const account = {
    id: 'credit-1',
    status: 'ACTIVE',
    creditLimit: 50_000,
    creditDays: 30,
    balanceUsed: 0,
  };
  const payments: FakePayment[] = [];
  const paymentTransactions: { paymentId: string }[] = [];
  const creditMovements: { orderId: string; amount: number }[] = [];
  const locks = new Map<string, Promise<void>>();
  const lockSql: string[] = [];

  const orderView = (id: string) => {
    const order = orders.get(id);
    if (!order) return null;
    return {
      ...order,
      customer: {
        customerType: 'BUSINESS',
        user: { id: 'user-c1' },
        creditAccount: { ...account },
      },
      payments: payments
        .filter((payment) => payment.orderId === id)
        .map((payment) => ({ ...payment })),
    };
  };

  function makeTx(undo: (() => void)[], held: (() => void)[]) {
    return {
      $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
        lockSql.push(sql.join('?'));
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
        return [{ id: orderId }];
      },
      transportOrder: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          await yieldTurn();
          return orderView(where.id);
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          await yieldTurn();
          const order = orders.get(where.id)!;
          const before = { ...order };
          undo.push(() => Object.assign(order, before));
          Object.assign(order, data);
          return { ...order };
        },
      },
      payment: {
        create: async ({ data }: { data: Omit<FakePayment, 'id'> }) => {
          await yieldTurn();
          const payment = {
            ...data,
            amount: Number(data.amount),
            id: `pay-${payments.length + 1}`,
          };
          payments.push(payment);
          undo.push(() => payments.splice(payments.indexOf(payment), 1));
          return { ...payment };
        },
      },
      paymentTransaction: {
        create: async ({ data }: { data: { paymentId: string } }) => {
          await yieldTurn();
          paymentTransactions.push(data);
          undo.push(() =>
            paymentTransactions.splice(paymentTransactions.indexOf(data), 1),
          );
          return { id: `tx-${paymentTransactions.length}`, ...data };
        },
      },
      customerCreditAccount: {
        updateMany: async ({
          where,
          data,
        }: {
          where: { balanceUsed: { lte: number } };
          data: { balanceUsed: { increment: number } };
        }) => {
          await yieldTurn();
          if (account.balanceUsed > where.balanceUsed.lte) return { count: 0 };
          account.balanceUsed += data.balanceUsed.increment;
          undo.push(() => (account.balanceUsed -= data.balanceUsed.increment));
          return { count: 1 };
        },
        findUniqueOrThrow: async () => {
          await yieldTurn();
          return { balanceUsed: account.balanceUsed };
        },
      },
      customerCreditMovement: {
        create: async ({
          data,
        }: {
          data: { orderId: string; amount: number };
        }) => {
          await yieldTurn();
          creditMovements.push(data);
          undo.push(() =>
            creditMovements.splice(creditMovements.indexOf(data), 1),
          );
          return data;
        },
      },
    };
  }

  const prisma = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const undo: (() => void)[] = [];
      const held: (() => void)[] = [];
      try {
        return await fn(makeTx(undo, held));
      } catch (error) {
        undo.reverse().forEach((revert) => revert());
        throw error;
      } finally {
        held.forEach((release) => release());
      }
    },
    transportOrder: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        await yieldTurn();
        return orderView(where.id);
      },
    },
  };

  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    {} as PaymentProviderRegistry,
    {} as CardnetGateway,
    {} as ConfigType<typeof paymentConfig>,
  );

  return {
    service,
    orders,
    account,
    payments,
    paymentTransactions,
    creditMovements,
    lockSql,
  };
}

const credit = (db: ReturnType<typeof createFakeDb>, orderId = 'order-1') =>
  db.service.approveCorporateCredit({ orderId }, customer);

const check = (
  db: ReturnType<typeof createFakeDb>,
  options: { amount?: number; checkNumber?: string } = {},
) =>
  db.service.registerCheck(
    {
      orderId: 'order-1',
      bankName: 'BHD',
      checkNumber: options.checkNumber ?? '0001',
      ...(options.amount !== undefined && { amount: options.amount }),
    },
    operator,
  );

const outcome = (results: PromiseSettledResult<unknown>[]) => ({
  fulfilled: results.filter((result) => result.status === 'fulfilled').length,
  rejected: results
    .filter((result): result is PromiseRejectedResult => {
      return result.status === 'rejected';
    })
    .map((result) => (result.reason as { status?: number }).status),
});

describe('PaymentsService manual authorizations under concurrency (FIA-API-001)', () => {
  it('rejects a second sequential credit authorization (harness sanity)', async () => {
    const db = createFakeDb({ 'order-1': 5000 });

    await credit(db);
    await expect(credit(db)).rejects.toMatchObject({ status: 409 });

    expect(db.payments).toHaveLength(1);
    expect(db.account.balanceUsed).toBe(5000);
  });
  describe('US1: a double corporate credit submission charges once', () => {
    it('authorizes only one of two simultaneous credit requests', async () => {
      const db = createFakeDb({ 'order-1': 5000 });

      const results = await Promise.allSettled([credit(db), credit(db)]);

      expect(outcome(results)).toEqual({ fulfilled: 1, rejected: [409] });
      expect(db.payments).toHaveLength(1);
      expect(db.creditMovements).toHaveLength(1);
      expect(db.account.balanceUsed).toBe(5000);
    });

    it('leaves no transaction or credit movement behind for the rejected request', async () => {
      const db = createFakeDb({ 'order-1': 5000 });

      await Promise.allSettled([credit(db), credit(db)]);

      expect(db.paymentTransactions).toHaveLength(1);
      expect(db.creditMovements).toEqual([
        expect.objectContaining({ orderId: 'order-1', amount: 5000 }),
      ]);
    });

    it('does not block simultaneous credit on different orders', async () => {
      const db = createFakeDb({ 'order-1': 5000, 'order-2': 3000 });

      const results = await Promise.allSettled([
        credit(db, 'order-1'),
        credit(db, 'order-2'),
      ]);

      expect(outcome(results)).toEqual({ fulfilled: 2, rejected: [] });
      expect(db.account.balanceUsed).toBe(8000);
    });
  });

  describe('US2: check and credit at once do not cover the order twice', () => {
    it.each([
      ['check first', true],
      ['credit first', false],
    ])(
      'lets only one of a simultaneous check and credit through (%s)',
      async (_, checkFirst) => {
        const db = createFakeDb({ 'order-1': 5000 });

        const [checkResult, creditResult] = checkFirst
          ? await Promise.allSettled([check(db), credit(db)])
          : await Promise.allSettled([credit(db), check(db)]).then(
              ([creditFirst, checkSecond]) => [checkSecond, creditFirst],
            );

        expect(outcome([checkResult, creditResult])).toEqual({
          fulfilled: 1,
          rejected: [409],
        });
        expect(db.payments).toHaveLength(1);
        if (creditResult.status === 'rejected') {
          expect(db.account.balanceUsed).toBe(0);
          expect(db.creditMovements).toHaveLength(0);
        }
      },
    );

    it('registers the same check only once when submitted twice at once', async () => {
      const db = createFakeDb({ 'order-1': 5000 });

      const results = await Promise.allSettled([check(db), check(db)]);

      expect(outcome(results)).toEqual({ fulfilled: 1, rejected: [409] });
      expect(db.payments).toHaveLength(1);
    });
  });

  describe('US3: legitimate partial payments still work', () => {
    it('accepts two simultaneous partial checks that fit in the total', async () => {
      const db = createFakeDb({ 'order-1': 5000 });

      const results = await Promise.allSettled([
        check(db, { amount: 2000, checkNumber: '0001' }),
        check(db, { amount: 2000, checkNumber: '0002' }),
      ]);

      expect(outcome(results)).toEqual({ fulfilled: 2, rejected: [] });
      expect(db.payments).toHaveLength(2);
      expect(db.orders.get('order-1')?.paymentStatus).toBe(
        PAYMENT_STATUS.PENDING,
      );
    });

    it('rejects the partial check that would exceed the pending balance', async () => {
      const db = createFakeDb({ 'order-1': 5000 });

      const results = await Promise.allSettled([
        check(db, { amount: 3000, checkNumber: '0001' }),
        check(db, { amount: 3000, checkNumber: '0002' }),
      ]);

      expect(outcome(results)).toEqual({ fulfilled: 1, rejected: [409] });
      const rejected = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect(
        (rejected?.reason as { response?: { message?: string } }).response
          ?.message,
      ).toBe('Payment amount exceeds the order pending balance');
    });
  });
});
