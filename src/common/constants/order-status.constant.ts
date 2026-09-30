import { STATUS_ORDERS } from '@generated/prisma/enums';

/**
 * Paid orders still without a driver. REQUESTED waits for a dispatcher (or the
 * next automatic attempt); ASSIGNING_DRIVER has an automatic offer open right
 * now. Anything that assigns a driver must accept both.
 */
export const DISPATCH_WAITING_STATUSES: STATUS_ORDERS[] = [
  STATUS_ORDERS.REQUESTED,
  STATUS_ORDERS.ASSIGNING_DRIVER,
];
