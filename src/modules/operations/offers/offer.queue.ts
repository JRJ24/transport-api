/** BullMQ queue for dispatch offers: expiry timers and the auto sweep. */
export const MATCHING_QUEUE = 'matching';

export const OFFER_EXPIRE_JOB = 'offer-expire';
export const DISPATCH_SWEEP_JOB = 'dispatch-sweep';
export const DISPATCH_ORDER_JOB = 'dispatch-order';
/** Re-arms the sweep when a scheduled order enters its dispatch window. */
export const DISPATCH_WAKE_JOB = 'dispatch-wake';

/**
 * Redis flag: present while the sweep has work. Without it the sweep returns
 * before touching Postgres, so an idle API lets Neon scale to zero.
 */
export const SWEEP_ARMED_KEY = 'matching:sweep:armed';

export interface OfferExpireJob {
  offerId: string;
}

export interface DispatchOrderJob {
  orderId: string;
}

/**
 * Same rule as the notifications module: a Redis-backed queue exists only
 * when REDIS_URL is set. Without it presence is off, so there is nothing to
 * dispatch automatically either.
 */
export const MATCHING_QUEUE_ENABLED = Boolean(process.env.REDIS_URL);
