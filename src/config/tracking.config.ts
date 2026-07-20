import { registerAs } from '@nestjs/config';

/**
 * Tracking / GPS ingestion tuning. Anomalous points (poor accuracy, impossible
 * speed jumps) are classified and logged for review — never silently dropped.
 */
export const trackingConfig = registerAs('tracking', () => ({
  /** Points with accuracy worse than this (meters) are flagged as low-accuracy. */
  maxAccuracyMeters: Number(process.env.GPS_MAX_ACCURACY_M ?? 100),
  /** Implied speed above this (meters/second) is flagged as an impossible jump. */
  maxSpeedMps: Number(process.env.GPS_MAX_SPEED_MPS ?? 70),
  /** Max points accepted in a single batch sync. */
  maxBatchSize: Number(process.env.TRACKING_MAX_BATCH ?? 500),
}));
