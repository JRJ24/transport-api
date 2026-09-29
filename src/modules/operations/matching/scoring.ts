/**
 * Candidate scoring for driver matching.
 *
 * Mandatory conditions (availability, capacity, documents...) are filters
 * applied before this point; nothing here can compensate for failing one.
 * Among eligible drivers the ETA to the pickup is the main signal; the rest
 * nudge the order between drivers that arrive at about the same time.
 */

export interface ScoreWeights {
  eta: number;
  distance: number;
  reliability: number;
  balance: number;
}

/** Illustrative weights from the spec (§2.2), pending commercial approval. */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  eta: 0.55,
  distance: 0.15,
  reliability: 0.15,
  balance: 0.15,
};

/**
 * Absolute scales, not relative to the candidate set: a driver's score must
 * not change because someone else logged in across town.
 */
export const SCORE_SCALES = {
  /** An ETA at or above this scores 0. */
  etaCapSec: 30 * 60,
  /** A road distance at or above this scores 0. */
  distanceCapM: 15_000,
  /** This many trips today or more scores 0 on balance. */
  tripsCap: 10,
  /** Neutral reliability for drivers with no rating yet. */
  unratedReliability: 0.8,
};

export interface ScoreInputs {
  etaSeconds: number | null;
  roadDistanceMeters: number | null;
  straightLineMeters: number;
  /** 0..5; 0 means "not rated yet". */
  rating: number;
  /** accepted / answered offers, or null with no history. */
  acceptanceRate: number | null;
  tripsToday: number;
}

export interface ScoreBreakdown {
  eta: number;
  distance: number;
  reliability: number;
  balance: number;
}

export interface ScoredValue {
  score: number;
  breakdown: ScoreBreakdown;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Scales weights to sum 1 so a partial override stays comparable. */
export function normalizeWeights(weights: Partial<ScoreWeights>): ScoreWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...weights };
  const values = Object.values(merged);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    return DEFAULT_WEIGHTS;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return DEFAULT_WEIGHTS;
  }
  return {
    eta: merged.eta / total,
    distance: merged.distance / total,
    reliability: merged.reliability / total,
    balance: merged.balance / total,
  };
}

export function scoreCandidate(
  inputs: ScoreInputs,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): ScoredValue {
  // No ETA means no ETA component, never an invented one: such candidates
  // are also sorted after every candidate that has one (see compareRanked).
  const eta =
    inputs.etaSeconds === null
      ? 0
      : clamp01(1 - inputs.etaSeconds / SCORE_SCALES.etaCapSec);
  const distance = clamp01(
    1 -
      (inputs.roadDistanceMeters ?? inputs.straightLineMeters) /
        SCORE_SCALES.distanceCapM,
  );
  const ratingPart =
    inputs.rating > 0
      ? clamp01(inputs.rating / 5)
      : SCORE_SCALES.unratedReliability;
  const reliability =
    inputs.acceptanceRate === null
      ? ratingPart
      : 0.7 * ratingPart + 0.3 * clamp01(inputs.acceptanceRate);
  const balance = clamp01(1 - inputs.tripsToday / SCORE_SCALES.tripsCap);

  const breakdown: ScoreBreakdown = {
    eta: round4(eta),
    distance: round4(distance),
    reliability: round4(reliability),
    balance: round4(balance),
  };

  return {
    score: round4(
      weights.eta * eta +
        weights.distance * distance +
        weights.reliability * reliability +
        weights.balance * balance,
    ),
    breakdown,
  };
}

export interface Rankable {
  etaSeconds: number | null;
  score: number;
  straightLineMeters: number;
}

/**
 * Candidates with a road ETA first, then by score, then by who arrives first,
 * then by straight line as the last tie-breaker.
 */
export function compareRanked(a: Rankable, b: Rankable): number {
  const aHasEta = a.etaSeconds !== null;
  const bHasEta = b.etaSeconds !== null;
  if (aHasEta !== bHasEta) {
    return aHasEta ? -1 : 1;
  }
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  if (aHasEta && bHasEta && a.etaSeconds !== b.etaSeconds) {
    return (a.etaSeconds as number) - (b.etaSeconds as number);
  }
  return a.straightLineMeters - b.straightLineMeters;
}
