import { z } from 'zod';

const DURATION_PATTERN = /^\d+(ms|s|m|h|d)$/;

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  SWAGGER_ENABLED: z.enum(['true', 'false']).default('true'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),
  JWT_ACCESS_TTL: z.string().regex(DURATION_PATTERN).default('15m'),
  JWT_REFRESH_TTL_MOBILE: z.string().regex(DURATION_PATTERN).default('30d'),
  JWT_REFRESH_TTL_WEB: z.string().regex(DURATION_PATTERN).default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

  GPS_MAX_ACCURACY_M: z.coerce.number().positive().default(100),
  GPS_MAX_SPEED_MPS: z.coerce.number().positive().default(70),
  TRACKING_MAX_BATCH: z.coerce.number().int().positive().default(500),

  GOOGLE_MAPS_API_KEY: z.string().optional(),
  GOOGLE_MAPS_SERVER_API_KEY: z.string().optional(),
  GOOGLE_ROUTES_API_BASE_URL: z
    .string()
    .url()
    .default('https://routes.googleapis.com'),
  GOOGLE_ROUTES_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  GOOGLE_MAPS_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  GOOGLE_PLACES_API_BASE_URL: z
    .string()
    .url()
    .default('https://places.googleapis.com/v1'),
  GOOGLE_GEOCODING_API_BASE_URL: z
    .string()
    .url()
    .default('https://maps.googleapis.com/maps/api/geocode/json'),
  GOOGLE_ADDRESS_VALIDATION_API_BASE_URL: z
    .string()
    .url()
    .default('https://addressvalidation.googleapis.com/v1:validateAddress'),
  GOOGLE_ROADS_API_BASE_URL: z
    .string()
    .url()
    .default('https://roads.googleapis.com/v1'),
  GOOGLE_ROUTE_OPTIMIZATION_API_BASE_URL: z
    .string()
    .url()
    .default('https://routeoptimization.googleapis.com'),
  GOOGLE_ROUTE_OPTIMIZATION_PROJECT_ID: z.string().optional(),
  PAYMENT_PROVIDER: z
    .enum([
      'cardnet',
      'azul',
      'internal-mock',
      'CARDNET',
      'AZUL',
      'INTERNAL-MOCK',
    ])
    .default('cardnet'),
  PAYMENT_CALLBACK_BASE_URL: z.string().optional(),
  CARDNET_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  CARDNET_MERCHANT_ID: z.string().optional(),
  CARDNET_TERMINAL_ID: z.string().optional(),
  CARDNET_API_URL: z.string().optional(),
  CARDNET_API_KEY: z.string().optional(),
  CARDNET_SECRET_KEY: z.string().optional(),
  CARDNET_WEBHOOK_SECRET: z.string().optional(),
  AZUL_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  AZUL_MERCHANT_ID: z.string().optional(),
  AZUL_API_URL: z.string().optional(),
  AZUL_API_KEY: z.string().optional(),
  AZUL_SECRET_KEY: z.string().optional(),
  AZUL_WEBHOOK_SECRET: z.string().optional(),

  // ── Firebase Cloud Messaging (server-side only) ──────────────────────────
  FCM_PROJECT_ID: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  // ── Redis / BullMQ (push delivery queue) ─────────────────────────────────
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  NOTIFICATIONS_QUEUE_DRIVER: z.enum(['bullmq', 'inline']).optional(),

  // ── Evidence file storage (S3-compatible Spaces) ─────────────────────────
  STORAGE_DRIVER: z.enum(['spaces', 's3', 'local']).default('spaces'),
  SPACES_ENDPOINT: z.string().optional(),
  SPACES_REGION: z.string().default('nyc3'),
  SPACES_BUCKET: z.string().optional(),
  SPACES_NAME: z.string().optional(),
  SPACES_PUBLIC_URL: z.string().optional(),
  SPACES_UPLOAD_PREFIX: z.string().default('evidences'),
  SPACES_ACCESS_KEY_ID: z.string().optional(),
  SPACES_SECRET_ACCESS_KEY: z.string().optional(),
  ACCESS_KEY_ID: z.string().optional(),
  ACCESS_SECRET_KEY: z.string().optional(),
  ACCESS_KEY_NAME: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(50),
  LOCAL_UPLOAD_DIR: z.string().optional(),
  LOCAL_UPLOAD_PUBLIC_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Used by ConfigModule.forRoot({ validate }). Throws at bootstrap when the
 * environment is invalid so the application fails fast.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }

  cachedEnv = result.data;
  return result.data;
}

/**
 * Lazily-parsed environment for registerAs() factories, so defaults and
 * coercions from the schema apply everywhere consistently.
 */
export function env(): Env {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
}
