import type { ConfigType } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { STATUS_ACCOUNT } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { verifyPassword } from '@/common/utils/hash.util';
import type { authConfig } from '@/config';
import type { UsersService } from '../../../users/users.service';
import {
  AUTH_AUDIT_ACTIONS,
  type AuthAuditService,
} from '../auth-audit.service';
import type { AuthSessionIssuer } from '../auth-session.issuer';
import { LoginUseCase } from './login.use-case';

// Real verifyPassword, wrapped so the test can see which hash it got.
jest.mock('@/common/utils/hash.util', () => {
  const actual = jest.requireActual<typeof import('@/common/utils/hash.util')>(
    '@/common/utils/hash.util',
  );
  return { ...actual, verifyPassword: jest.fn(actual.verifyPassword) };
});

const context = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function setup(user: unknown) {
  const usersService = {
    findByEmailWithRoles: jest.fn().mockResolvedValue(user),
    updateLastLogin: jest.fn().mockResolvedValue(undefined),
  };
  const sessionIssuer = { issue: jest.fn().mockResolvedValue({ ok: true }) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const useCase = new LoginUseCase(
    usersService as unknown as UsersService,
    sessionIssuer as unknown as AuthSessionIssuer,
    audit as unknown as AuthAuditService,
    { bcryptSaltRounds: 10 } as ConfigType<typeof authConfig>,
  );
  return { useCase, sessionIssuer, audit };
}

describe('LoginUseCase dummy hash cost (SEC-API-013)', () => {
  afterEach(() => jest.clearAllMocks());

  it('compares an unknown email against a dummy hash with the configured cost', async () => {
    const { useCase, audit } = setup(null);
    await useCase.onModuleInit();

    await expect(
      useCase.execute(
        { email: 'nobody@x.com', password: 'Secret123' },
        context,
      ),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.INVALID_CREDENTIALS },
    });

    expect(verifyPassword).toHaveBeenCalledWith(
      'Secret123',
      expect.stringMatching(/^\$2[aby]\$10\$/),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.LOGIN_FAILED }),
    );
  });

  it('still logs in a user with the right password', async () => {
    const user = {
      id: 'u1',
      status: STATUS_ACCOUNT.ACTIVE,
      passwordHash: await bcrypt.hash('Secret123', 10),
      userRoles: [],
    };
    const { useCase, sessionIssuer } = setup(user);
    await useCase.onModuleInit();

    await useCase.execute(
      { email: 'u1@x.com', password: 'Secret123' },
      context,
    );

    expect(sessionIssuer.issue).toHaveBeenCalled();
  });
});
