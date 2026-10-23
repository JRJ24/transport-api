import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export const authConfig = registerAs('auth', () => {
  const e = env();

  return {
    accessSecret: e.JWT_ACCESS_SECRET,
    refreshSecret: e.JWT_REFRESH_SECRET,
    accessTtl: e.JWT_ACCESS_TTL,
    refreshTtlMobile: e.JWT_REFRESH_TTL_MOBILE,
    refreshTtlWeb: e.JWT_REFRESH_TTL_WEB,
    refreshReuseGraceSeconds: e.JWT_REFRESH_REUSE_GRACE_SECONDS,
    bcryptSaltRounds: e.BCRYPT_SALT_ROUNDS,
  };
});
