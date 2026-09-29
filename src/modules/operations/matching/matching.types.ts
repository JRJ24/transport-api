import type { ScoreBreakdown, ScoreWeights } from './scoring';

/** Why a driver near the pickup is not in the ranking. Shown in the TMS. */
export type ExclusionReason =
  | 'DRIVER_NOT_FOUND'
  | 'NOT_APPROVED'
  | 'NOT_AVAILABLE'
  | 'LICENSE_EXPIRED'
  | 'NO_ACTIVE_VEHICLE_IN_CATEGORY'
  | 'VEHICLE_DOCUMENTS_INVALID'
  | 'ACTIVE_TRIP'
  | 'OFFER_PENDING_ELSEWHERE'
  | 'ALREADY_OFFERED'
  | 'POSITION_STALE'
  | 'POSITION_LOW_ACCURACY'
  | 'NO_ROUTE_TO_PICKUP'
  | 'OUTSIDE_PRESELECTION';

export type EtaStatus = 'OK' | 'NO_ROUTE' | 'FAILED';

export type MatchingAlert =
  'PRESENCE_DISABLED' | 'NO_CANDIDATES' | 'ROUTES_PROVIDER_FAILED';

export interface RankedCandidate {
  rank: number;
  driverId: string;
  driverName: string | null;
  vehicleId: string;
  plateNumber: string | null;
  vehicleCategoryId: string;
  /** Road ETA to the pickup; null when the provider could not estimate it. */
  etaSeconds: number | null;
  etaStatus: EtaStatus;
  roadDistanceMeters: number | null;
  straightLineMeters: number;
  /** Seconds since the position was observed on the device. */
  positionAgeSec: number;
  positionObservedAt: string;
  accuracyM: number | null;
  h3Cell: string;
  /** H3 ring around the pickup cell the driver was found in. */
  ring: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  rating: number;
  acceptanceRate: number | null;
  tripsToday: number;
}

export interface ExcludedCandidate {
  driverId: string;
  driverName: string | null;
  reason: ExclusionReason;
  ring: number | null;
  positionAgeSec: number | null;
  detail?: string;
}

export interface MatchingResult {
  orderId: string;
  pickup: { latitude: number; longitude: number; h3Cell: string };
  h3Resolution: number;
  ringsSearched: number;
  scoreVersion: string;
  weights: ScoreWeights;
  etaProvider: 'google-routes' | 'internal-mock' | null;
  computedAt: string;
  candidates: RankedCandidate[];
  excluded: ExcludedCandidate[];
  alerts: MatchingAlert[];
}

export interface RankOptions {
  /** Drivers never to rank for this order (already offered, rejected...). */
  excludeDriverIds?: string[];
  /** Emit realtime alerts to operations when something needs a human. */
  emitAlerts?: boolean;
}
