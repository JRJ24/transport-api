import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { authConfig } from '@/config';
import { TokenService } from './token.service';

const auth = {
  accessSecret: 'a'.repeat(32),
  refreshSecret: 'b'.repeat(32),
  accessTtl: '15m',
  refreshTtlMobile: '30d',
  refreshTtlWeb: '7d',
  bcryptSaltRounds: 10,
  refreshReuseGraceSeconds: 30,
} as ConfigType<typeof authConfig>;

const input = { userId: 'user-1', sessionId: 'session-1', ttl: '7d' };
const SEVEN_DAYS = 7 * 24 * 60 * 60;

describe('TokenService.signRefreshToken', () => {
  const tokens = new TokenService(new JwtService(), auth);

  it('signs with the given issuedAt so exp = issuedAt + ttl', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 10;

    const token = await tokens.signRefreshToken({ ...input, issuedAt });
    const payload = await tokens.verifyRefreshToken(token);

    expect(payload.iat).toBe(issuedAt);
    expect(payload.exp).toBe(issuedAt + SEVEN_DAYS);
  });

  it('produces the exact same token for the same issuedAt', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 10;

    const first = await tokens.signRefreshToken({ ...input, issuedAt });
    const second = await tokens.signRefreshToken({ ...input, issuedAt });

    expect(second).toBe(first);
  });
});
