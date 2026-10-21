import {
  ORDER_CANCELLATION,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import {
  CUSTOMER_CANCELLABLE_STATUSES,
  cancellationFee,
  collectedAmount,
  isPastCancellationDeadline,
} from './cancellation-policy';

describe('cancellation deadline (LOG-API-009)', () => {
  const base = {
    cancellationType: ORDER_CANCELLATION.CUSTOMER_CANCELLED,
    ruleFee: 150,
    collected: 1000,
    status: STATUS_ORDERS.REQUESTED,
  };

  it('charges a scheduled order cancelled past its deadline, with no driver yet', () => {
    expect(cancellationFee({ ...base, pastCancellationDeadline: true })).toBe(
      150,
    );
    expect(cancellationFee({ ...base, pastCancellationDeadline: false })).toBe(
      0,
    );
  });

  it('never charges operations or a driver for a late cancel', () => {
    expect(
      cancellationFee({
        ...base,
        cancellationType: ORDER_CANCELLATION.ADMIN_CANCELLED,
        pastCancellationDeadline: true,
      }),
    ).toBe(0);
  });

  it('a deadline counts as passed from its exact minute on', () => {
    const now = new Date('2026-10-21T15:00:00Z');
    expect(
      isPastCancellationDeadline([{ cancellationDeadline: now }], now),
    ).toBe(true);
    expect(
      isPastCancellationDeadline(
        [{ cancellationDeadline: new Date('2026-10-21T15:01:00Z') }],
        now,
      ),
    ).toBe(false);
    expect(isPastCancellationDeadline([], now)).toBe(false);
  });
});

describe('cancellation policy', () => {
  it('lets a customer cancel until the trip starts, never after', () => {
    expect(CUSTOMER_CANCELLABLE_STATUSES.has(STATUS_ORDERS.ACCEPTED)).toBe(
      true,
    );
    for (const status of [
      STATUS_ORDERS.IN_PROGRESS,
      STATUS_ORDERS.DELIVERED,
      STATUS_ORDERS.FAILED,
      STATUS_ORDERS.CANCELLED,
    ]) {
      expect(CUSTOMER_CANCELLABLE_STATUSES.has(status)).toBe(false);
    }
  });

  it('counts captured money and authorized checks/credit, not open attempts', () => {
    expect(
      collectedAmount([
        {
          amount: 500 as never,
          paymentMethod: PAYMENT_METHOD.CARD,
          status: PAYMENT_STATUS.PAID,
        },
        {
          amount: 300 as never,
          paymentMethod: PAYMENT_METHOD.CORPORATE_CREDIT,
          status: PAYMENT_STATUS.AUTHORIZED,
        },
        {
          amount: 999 as never,
          paymentMethod: PAYMENT_METHOD.CARD,
          status: PAYMENT_STATUS.PROCESSING,
        },
        {
          amount: 999 as never,
          paymentMethod: PAYMENT_METHOD.CARD,
          status: PAYMENT_STATUS.AUTHORIZED,
        },
      ]),
    ).toBe(800);
  });

  const base = {
    cancellationType: ORDER_CANCELLATION.CUSTOMER_CANCELLED,
    ruleFee: 150,
    collected: 1000,
  };

  it.each([
    STATUS_ORDERS.ASSIGNED,
    STATUS_ORDERS.ACCEPTED,
    STATUS_ORDERS.IN_PROGRESS,
  ])('charges the fee with a driver committed (%s)', (status) => {
    expect(cancellationFee({ ...base, status })).toBe(150);
  });

  it.each([
    STATUS_ORDERS.PENDING_PAYMENT,
    STATUS_ORDERS.REQUESTED,
    STATUS_ORDERS.ASSIGNING_DRIVER,
  ])('charges nothing before a driver is committed (%s)', (status) => {
    expect(cancellationFee({ ...base, status })).toBe(0);
  });

  it.each([
    ORDER_CANCELLATION.ADMIN_CANCELLED,
    ORDER_CANCELLATION.DRIVER_CANCELLED,
  ])('charges nothing when the customer did not cancel (%s)', (type) => {
    expect(
      cancellationFee({
        ...base,
        cancellationType: type,
        status: STATUS_ORDERS.ACCEPTED,
      }),
    ).toBe(0);
  });

  it('never keeps more than was collected', () => {
    expect(
      cancellationFee({
        ...base,
        status: STATUS_ORDERS.ACCEPTED,
        collected: 80,
      }),
    ).toBe(80);
    expect(
      cancellationFee({
        ...base,
        status: STATUS_ORDERS.ACCEPTED,
        collected: 0,
      }),
    ).toBe(0);
  });
});
