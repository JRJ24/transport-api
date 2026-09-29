/** BullMQ queue for dispatch offers: expiry timers and the auto sweep. */
export const MATCHING_QUEUE = 'matching';

export const OFFER_EXPIRE_JOB = 'offer-expire';
export const DISPATCH_SWEEP_JOB = 'dispatch-sweep';

export interface OfferExpireJob {
  offerId: string;
}

/**
 * Same rule as the notifications module: a Redis-backed queue exists only
 * when REDIS_URL is set. Without it presence is off, so there is nothing to
 * dispatch automatically either.
 */
export const MATCHING_QUEUE_ENABLED = Boolean(process.env.REDIS_URL);
