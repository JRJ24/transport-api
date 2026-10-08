import { registerAs } from '@nestjs/config';

/*
 * Tope absoluto de puntos por lote. Lo aplica BatchLocationsDto: los
 * decoradores se evaluan al cargar la clase, antes de que exista la config,
 * asi que TRACKING_MAX_BATCH solo puede bajarlo (el servicio lo valida).
 */
export const TRACKING_BATCH_HARD_MAX = 500;

/**
 * Tracking / GPS ingestion tuning. Anomalous points (poor accuracy, impossible
 * speed jumps) are classified and logged for review — never silently dropped.
 */
export const trackingConfig = registerAs('tracking', () => ({
  /** Points with accuracy worse than this (meters) are flagged as low-accuracy. */
  maxAccuracyMeters: Number(process.env.GPS_MAX_ACCURACY_M ?? 100),
  /** Implied speed above this (meters/second) is flagged as an impossible jump. */
  maxSpeedMps: Number(process.env.GPS_MAX_SPEED_MPS ?? 70),
  /** Max points accepted in a single batch sync (never above the DTO cap). */
  maxBatchSize: Math.min(
    Number(process.env.TRACKING_MAX_BATCH ?? TRACKING_BATCH_HARD_MAX),
    TRACKING_BATCH_HARD_MAX,
  ),
  /*
   * Segundos tras la entrega en que una sesion aun ACTIVE acepta puntos. La
   * app marca DELIVERED y despues vacia la cola y cierra la sesion; pasado
   * este margen vuelve el 403, que es lo que apaga el task de background si
   * la app murio antes de cerrar la sesion.
   */
  deliveredGraceSeconds: 300,
}));
