import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export const appConfig = registerAs('app', () => {
  const e = env();

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    apiPrefix: e.API_PREFIX,
    corsOrigins: e.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    swaggerEnabled: e.SWAGGER_ENABLED === 'true',
    logLevel: e.LOG_LEVEL,
    throttleTtlMs: e.THROTTLE_TTL_MS,
    throttleLimit: e.THROTTLE_LIMIT,
  };
});
