import { UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type {
  RotatedSession,
  SessionsService,
} from '../../../sessions/sessions.service';
import type { TokenService } from '../../../sessions/token.service';
import {
  AUTH_AUDIT_ACTIONS,
  type AuthAuditService,
} from '../auth-audit.service';
import { RefreshSessionUseCase } from './refresh-session.use-case';

const context = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function setup(rotateSession: jest.Mock) {
  const record = jest.fn().mockResolvedValue(undefined);
  const useCase = new RefreshSessionUseCase(
    { rotateSession } as unknown as SessionsService,
    {
      signAccessToken: jest.fn().mockResolvedValue('access-token'),
      accessTokenTtlSeconds: 900,
    } as unknown as TokenService,
    { record } as unknown as AuthAuditService,
  );
  return { useCase, record };
}

describe('RefreshSessionUseCase', () => {
  it('returns the rotated refresh token without auditing a reuse', async () => {
    const rotated = {
      session: { id: 's1', userId: 'u1', user: { userRoles: [] } },
      refreshToken: 'refresh-current',
    } as unknown as RotatedSession;
    const { useCase, record } = setup(jest.fn().mockResolvedValue(rotated));

    await expect(useCase.execute('refresh-previous', context)).resolves.toEqual(
      {
        accessToken: 'access-token',
        refreshToken: 'refresh-current',
        tokenType: 'Bearer',
        expiresIn: 900,
      },
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('audits real reuse and rethrows it', async () => {
    const reuse = new UnauthorizedException({
      code: ERROR_CODES.TOKEN_REUSE_DETECTED,
    });
    const { useCase, record } = setup(jest.fn().mockRejectedValue(reuse));

    await expect(useCase.execute('refresh-stale', context)).rejects.toBe(reuse);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUTH_AUDIT_ACTIONS.REFRESH_REUSE_DETECTED,
      }),
    );
  });
});
