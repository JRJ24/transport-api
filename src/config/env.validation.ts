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
