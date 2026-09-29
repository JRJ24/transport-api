import { registerAs } from '@nestjs/config';

/**
 * Driver presence, candidate search and dispatch-offer tuning.
 *
 * Every number here is a starting point to be tuned per zone with real
 * traffic, not an approved commercial rule (see the matching spec, §2.1).
 */
export const matchingConfig = registerAs('matching', () => ({
  /** H3 resolution for presence cells. 8 ≈ 460 m edge. */
  h3Resolution: Number(process.env.MATCHING_H3_RES ?? 8),
  /** How many rings around the pickup cell the search may grow to. */
  maxRings: Number(process.env.MATCHING_MAX_RINGS ?? 3),
  /** Stop growing rings once this many present drivers are found. */
  minCandidates: Number(process.env.MATCHING_MIN_CANDIDATES ?? 5),
  /** Max origins sent to one Route Matrix call (billed per element). */
  maxMatrixOrigins: Number(process.env.MATCHING_MAX_MATRIX ?? 25),
  /** A position older than this no longer counts as presence. */
  presenceTtlSec: Number(process.env.PRESENCE_TTL_SEC ?? 60),
  /** Positions less accurate than this are rejected for presence. */
  presenceMaxAccuracyM: Number(
    process.env.PRESENCE_MAX_ACCURACY_M ??
      process.env.GPS_MAX_ACCURACY_M ??
      100,
  ),
  /** Minimum gap between two accepted presence pings from one driver. */
  presenceMinIntervalMs: Number(process.env.PRESENCE_MIN_INTERVAL_MS ?? 3000),
  /** Offer orders automatically to the best-ranked driver. */
  autoOffer: (process.env.MATCHING_AUTO_OFFER ?? 'off') as 'off' | 'on',
  /** How long a driver has to answer an automatic offer. */
  offerTtlSec: Number(process.env.OFFER_TTL_SEC ?? 30),
  /**
   * `on`: a TMS pick must be an eligible candidate (fresh presence, filters
   * passed). `off` (rollout default, while driver apps start sending
   * presence): the pick is audited with its exclusion reason but allowed.
   */
  manualEnforce: (process.env.MATCHING_MANUAL_ENFORCE ?? 'off') as 'off' | 'on',
  /** Automatic dispatch sweep period. */
  sweepIntervalMs: Number(process.env.MATCHING_SWEEP_MS ?? 10_000),
  /** Wait before retrying an order no driver could take. */
  retryCooldownSec: Number(process.env.MATCHING_RETRY_COOLDOWN_SEC ?? 60),
  /** Version stamped on every ranking so TMS and auto mode are comparable. */
  scoreVersion: process.env.MATCHING_SCORE_VERSION ?? 'v1',
}));

/**
 * Demand-based multiplier. `shadow` computes and records the multiplier but
 * charges 1.00, so it can be simulated before it is commercially approved.
 */
export const demandConfig = registerAs('demand', () => ({
  mode: (process.env.DEMAND_PRICING ?? 'off') as 'off' | 'shadow' | 'on',
  /** H3 resolution demand is aggregated at. 7 ≈ 1.2 km edge. */
  h3Resolution: Number(process.env.DEMAND_H3_RES ?? 7),
  windowSec: Number(process.env.DEMAND_WINDOW_SEC ?? 600),
  /** Below this many requests in the window the multiplier stays at 1.00. */
  minObservations: Number(process.env.DEMAND_MIN_OBSERVATIONS ?? 3),
  /** Hard ceiling, whatever the bands say. */
  maxMultiplier: Number(process.env.DEMAND_MAX_MULTIPLIER ?? 1.35),
  /** EMA weight of the newest ratio (0..1]. */
  smoothing: Number(process.env.DEMAND_SMOOTHING ?? 0.5),
  /** The ratio must drop this far below a band floor before stepping down. */
  hysteresis: Number(process.env.DEMAND_HYSTERESIS ?? 0.2),
}));
