import type { Payment } from '@generated/prisma/client';
import {
  ORDER_CANCELLATION,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  STATUS_ORDERS,
} from '@generated/prisma/enums';

/**
 * Who may cancel what, and what it costs. One module so the fee the customer
 * is shown (GET /cancellation-fees) and the fee the cancellation charges
 * (POST /orders/:id/cancel) cannot drift apart (LOG-API-007).
 */

/**
 * A customer may cancel until the trip starts. Once the cargo is on the truck
 * (IN_PROGRESS) only operations can stop it; terminal orders never.
 */
export const CUSTOMER_CANCELLABLE_STATUSES = new Set<STATUS_ORDERS>([
  STATUS_ORDERS.DRAFT,
  STATUS_ORDERS.PENDING_QUOTE,
  STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
  STATUS_ORDERS.PENDING_PAYMENT,
  STATUS_ORDERS.CONFIRMED,
  STATUS_ORDERS.REQUESTED,
  STATUS_ORDERS.ASSIGNING_DRIVER,
  STATUS_ORDERS.ASSIGNED,
  STATUS_ORDERS.ACCEPTED,
]);

/** A driver already set out for the order: cancelling costs them the trip. */
const DRIVER_COMMITTED_STATUSES = new Set<STATUS_ORDERS>([
  STATUS_ORDERS.ASSIGNED,
  STATUS_ORDERS.ACCEPTED,
  STATUS_ORDERS.IN_PROGRESS,
]);

/** Types staff may record. SYSTEM_CANCELLED is for the platform's own jobs. */
export const STAFF_CANCELLATION_TYPES = new Set<ORDER_CANCELLATION>([
  ORDER_CANCELLATION.ADMIN_CANCELLED,
  ORDER_CANCELLATION.CUSTOMER_CANCELLED,
  ORDER_CANCELLATION.DRIVER_CANCELLED,
]);

const MANUAL_METHODS = new Set<PAYMENT_METHOD>([
  PAYMENT_METHOD.CHECK,
  PAYMENT_METHOD.CORPORATE_CREDIT,
]);

/** Money the order actually holds: captured, or a check/credit authorized. */
export function isCollected(
  payment: Pick<Payment, 'status' | 'paymentMethod'>,
): boolean {
  return (
    payment.status === PAYMENT_STATUS.PAID ||
    (payment.status === PAYMENT_STATUS.AUTHORIZED &&
      MANUAL_METHODS.has(payment.paymentMethod))
  );
}

export function collectedAmount(
  payments: Pick<Payment, 'status' | 'paymentMethod' | 'amount'>[],
): number {
  return roundMoney(
    payments
      .filter(isCollected)
      .reduce((total, payment) => total + Number(payment.amount), 0),
  );
}

/**
 * The rate rule's fee, only when the customer walks away from a driver who is
 * already committed, and never more than was collected: a fee is kept from
 * the payment, not billed on top of an unpaid order.
 */
export function cancellationFee(input: {
  status: STATUS_ORDERS;
  cancellationType: ORDER_CANCELLATION;
  ruleFee: number;
  collected: number;
}): number {
  if (
    input.cancellationType !== ORDER_CANCELLATION.CUSTOMER_CANCELLED ||
    !DRIVER_COMMITTED_STATUSES.has(input.status)
  ) {
    return 0;
  }
  return roundMoney(Math.min(Math.max(input.ruleFee, 0), input.collected));
}

export function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
