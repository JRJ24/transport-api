import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { UserSession } from '@generated/prisma/client';
import { STATUS_ACCOUNT } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { authConfig } from '@/config';
import type {
  SessionsRepository,
  SessionWithUser,
} from './sessions.repository';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';

/**
 * In-memory stand-in for SessionsRepository that mirrors the conditional
 * semantics of the real queries (rotation only wins on the current hash).
 */
class InMemorySessions {
  readonly rows = new Map<string, UserSession>();
  accountStatus: STATUS_ACCOUNT = STATUS_ACCOUNT.ACTIVE;

  create(data: {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    platform?: string;
  }): Promise<UserSession> {
    const now = new Date();
    const row: UserSession = {
      id: data.id,
      userId: data.userId,
      refreshTokenHash: data.refreshTokenHash,
      previousRefreshTokenHash: null,
      refreshRotatedAt: null,
      deviceId: null,
      deviceName: null,
      platform: data.platform ?? null,
      ipAddress: null,
      userAgent: null,
      lastActivityAt: now,
      expiresAt: data.expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  findById(id: string): Promise<UserSession | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : null);
  }

  findValidWithUser(
    id: string,
    createdAfter?: Date,
  ): Promise<SessionWithUser | null> {
    const row = this.rows.get(id);
    if (
      !row ||
      row.revokedAt ||
      row.expiresAt <= new Date() ||
      (createdAfter && row.createdAt <= createdAfter)
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...row,
      user: { status: this.accountStatus, userRoles: [] },
    } as unknown as SessionWithUser);
  }

  rotateRefreshToken(input: {
    sessionId: string;
    currentHash: string;
    nextHash: string;
    expiresAt: Date;
    rotatedAt: Date;
  }): Promise<number> {
    const row = this.rows.get(input.sessionId);
    if (!row || row.revokedAt || row.refreshTokenHash !== input.currentHash) {
      return Promise.resolve(0);
    }
    row.previousRefreshTokenHash = input.currentHash;
    row.refreshTokenHash = input.nextHash;
    row.refreshRotatedAt = input.rotatedAt;
    row.expiresAt = input.expiresAt;
    return Promise.resolve(1);
  }

  revoke(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row && !row.revokedAt) row.revokedAt = new Date();
    return Promise.resolve();
  }
}

const authFor = (refreshReuseGraceSeconds: number, sessionMaxAge = '90d') =>
  ({
    accessSecret: 'a'.repeat(32),
    refreshSecret: 'b'.repeat(32),
    accessTtl: '15m',
    refreshTtlMobile: '30d',
    refreshTtlWeb: '7d',
    bcryptSaltRounds: 10,
    refreshReuseGraceSeconds,
    sessionMaxAge,
  }) as ConfigType<typeof authConfig>;

function setup(graceSeconds = 30, sessionMaxAge = '90d') {
  const repository = new InMemorySessions();
  const auth = authFor(graceSeconds, sessionMaxAge);
  const service = new SessionsService(
    repository as unknown as SessionsRepository,
    new TokenService(new JwtService(), auth),
    auth,
  );
  return { repository, service };
}

const errorCode = (error: unknown): string | undefined =>
  ((error as { getResponse?: () => { code?: string } }).getResponse?.() ?? {})
    .code;

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return errorCode(error) ?? 'unknown';
  }
  throw new Error('expected the promise to reject');
}

describe('SessionsService.rotateSession, reuse grace window (FIA-API-005)', () => {
  beforeEach(() => {
    // Solo se simula el reloj: la firma JWT asíncrona necesita nextTick y
    // setImmediate reales.
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'queueMicrotask',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    });
    jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  /** Login, then a first rotation one minute later: returns T1, T2. */
  async function loginAndRotate(service: SessionsService) {
    const { sessionId, refreshToken: t1 } = await service.createSession({
      userId: 'user-1',
      platform: 'web',
    });
    jest.advanceTimersByTime(60_000);
    const { refreshToken: t2 } = await service.rotateSession(t1);
    expect(t2).not.toBe(t1);
    return { sessionId, t1, t2 };
  }

  describe('US1: concurrent legitimate refreshes keep the session', () => {
    it('returns the current refresh token when the previous one is replayed right away', async () => {
      const { repository, service } = setup();
      const { sessionId, t1, t2 } = await loginAndRotate(service);

      const replay = await service.rotateSession(t1);

      expect(replay.refreshToken).toBe(t2);
      expect(repository.rows.get(sessionId)?.revokedAt).toBeNull();
    });

    it('still grants the grace 29 seconds after the rotation', async () => {
      const { service } = setup();
      const { t1, t2 } = await loginAndRotate(service);

      jest.advanceTimersByTime(29_000);

      await expect(service.rotateSession(t1)).resolves.toMatchObject({
        refreshToken: t2,
      });
    });

    it('resolves two simultaneous refreshes with the same token to the same refresh token', async () => {
      const { repository, service } = setup();
      const { sessionId, refreshToken: t1 } = await service.createSession({
        userId: 'user-1',
        platform: 'mobile',
      });
      jest.advanceTimersByTime(60_000);

      const [a, b] = await Promise.all([
        service.rotateSession(t1),
        service.rotateSession(t1),
      ]);

      expect(a.refreshToken).toBe(b.refreshToken);
      expect(a.refreshToken).not.toBe(t1);
      expect(repository.rows.get(sessionId)?.revokedAt).toBeNull();
    });

    it('lets the token handed out by the grace path rotate normally afterwards', async () => {
      const { service } = setup();
      const { t1 } = await loginAndRotate(service);
      const replay = await service.rotateSession(t1);

      jest.advanceTimersByTime(60_000);
      const next = await service.rotateSession(replay.refreshToken);

      expect(next.refreshToken).not.toBe(replay.refreshToken);
    });
  });

  describe('US2: real reuse is still detected', () => {
    it('revokes the session when the previous token shows up after the window', async () => {
      const { repository, service } = setup();
      const { sessionId, t1, t2 } = await loginAndRotate(service);

      jest.advanceTimersByTime(31_000);

      expect(await rejectionCode(service.rotateSession(t1))).toBe(
        ERROR_CODES.TOKEN_REUSE_DETECTED,
      );
      expect(repository.rows.get(sessionId)?.revokedAt).not.toBeNull();
      expect(await rejectionCode(service.rotateSession(t2))).toBe(
        ERROR_CODES.INVALID_REFRESH_TOKEN,
      );
    });

    it('treats a token two generations old as reuse even inside the window', async () => {
      const { repository, service } = setup();
      const { sessionId, t1, t2 } = await loginAndRotate(service);
      jest.advanceTimersByTime(1_000);
      await service.rotateSession(t2);

      expect(await rejectionCode(service.rotateSession(t1))).toBe(
        ERROR_CODES.TOKEN_REUSE_DETECTED,
      );
      expect(repository.rows.get(sessionId)?.revokedAt).not.toBeNull();
    });

    it('does not revive a revoked session inside the window', async () => {
      const { service } = setup();
      const { sessionId, t1 } = await loginAndRotate(service);
      await service.revokeSession(sessionId);

      expect(await rejectionCode(service.rotateSession(t1))).toBe(
        ERROR_CODES.INVALID_REFRESH_TOKEN,
      );
    });

    it('keeps the current behaviour when the window is configured to 0', async () => {
      const { repository, service } = setup(0);
      const { sessionId, t1 } = await loginAndRotate(service);

      expect(await rejectionCode(service.rotateSession(t1))).toBe(
        ERROR_CODES.TOKEN_REUSE_DETECTED,
      );
      expect(repository.rows.get(sessionId)?.revokedAt).not.toBeNull();
    });

    it('fails closed without revoking when the regenerated token does not match', async () => {
      const { repository, service } = setup();
      const { sessionId, t1 } = await loginAndRotate(service);
      // Simula un cambio de secreto o TTL en medio de la ventana.
      const row = repository.rows.get(sessionId)!;
      row.refreshTokenHash = 'hash-that-cannot-be-regenerated';

      expect(await rejectionCode(service.rotateSession(t1))).toBe(
        ERROR_CODES.INVALID_REFRESH_TOKEN,
      );
      expect(repository.rows.get(sessionId)?.revokedAt).toBeNull();
    });

    it('treats a stale token as reuse on sessions without rotation history', async () => {
      const { repository, service } = setup();
      const { sessionId, t1, t2 } = await loginAndRotate(service);
      // Fila anterior al despliegue: sin hash previo ni fecha de rotación.
      const row = repository.rows.get(sessionId)!;
      row.previousRefreshTokenHash = null;
      row.refreshRotatedAt = null;

      expect(await rejectionCode(service.rotateSession(t1))).toBe(
        ERROR_CODES.TOKEN_REUSE_DETECTED,
      );
      expect(t2).toBeDefined();
    });
  });

  describe('SEC-API-019: refresh rejects accounts that are not active', () => {
    it.each([STATUS_ACCOUNT.BLOCKED, STATUS_ACCOUNT.INACTIVE])(
      'answers 403 and revokes the session for good when the account is %s',
      async (status) => {
        const { repository, service } = setup();
        const { sessionId, refreshToken } = await service.createSession({
          userId: 'user-1',
          platform: 'web',
        });
        repository.accountStatus = status;

        await expect(service.rotateSession(refreshToken)).rejects.toMatchObject(
          { status: 403 },
        );
        expect(repository.rows.get(sessionId)?.revokedAt).not.toBeNull();

        // Reactivar la cuenta no revive la sesión.
        repository.accountStatus = STATUS_ACCOUNT.ACTIVE;
        expect(await rejectionCode(service.rotateSession(refreshToken))).toBe(
          ERROR_CODES.INVALID_REFRESH_TOKEN,
        );
      },
    );

    it.each([
      [STATUS_ACCOUNT.BLOCKED, ERROR_CODES.ACCOUNT_BLOCKED],
      [STATUS_ACCOUNT.INACTIVE, ERROR_CODES.ACCOUNT_INACTIVE],
    ])('uses the login error code for a %s account', async (status, code) => {
      const { repository, service } = setup();
      const { refreshToken } = await service.createSession({
        userId: 'user-1',
        platform: 'web',
      });
      repository.accountStatus = status;

      expect(await rejectionCode(service.rotateSession(refreshToken))).toBe(
        code,
      );
    });

    it('does not hand out tokens through the grace window to a blocked account', async () => {
      const { repository, service } = setup();
      const { sessionId, t1 } = await loginAndRotate(service);
      repository.accountStatus = STATUS_ACCOUNT.BLOCKED;

      expect(await rejectionCode(service.rotateSession(t1))).toBe(
        ERROR_CODES.ACCOUNT_BLOCKED,
      );
      expect(repository.rows.get(sessionId)?.revokedAt).not.toBeNull();
    });
  });

  describe('SEC-API-018: sessions have an absolute maximum lifetime', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('never creates a session that expires after the cap', async () => {
      const { service } = setup(30, '1d');

      const { expiresAt } = await service.createSession({
        userId: 'user-1',
        platform: 'web',
      });

      expect(expiresAt.getTime()).toBe(Date.now() + DAY);
    });

    it('does not let a refresh push the expiry past the cap', async () => {
      const { repository, service } = setup(30, '10d');
      const { sessionId, refreshToken } = await service.createSession({
        userId: 'user-1',
        platform: 'web',
      });
      const createdAt = repository.rows.get(sessionId)!.createdAt.getTime();

      jest.advanceTimersByTime(5 * DAY);
      const second = await service.rotateSession(refreshToken);
      jest.advanceTimersByTime(4 * DAY);
      await service.rotateSession(second.refreshToken);

      expect(repository.rows.get(sessionId)!.expiresAt.getTime()).toBe(
        createdAt + 10 * DAY,
      );
    });

    it('refuses to refresh a session older than the cap, even with a future expiry', async () => {
      const { repository, service } = setup(30, '10d');
      const { sessionId, refreshToken } = await service.createSession({
        userId: 'user-1',
        platform: 'mobile', // TTL de 30d: el JWT sigue vigente, solo cuenta el tope
      });
      // Sesión anterior al despliegue: su expiresAt ya se extendió más allá.
      jest.advanceTimersByTime(11 * DAY);
      repository.rows.get(sessionId)!.expiresAt = new Date(Date.now() + DAY);

      expect(await rejectionCode(service.rotateSession(refreshToken))).toBe(
        ERROR_CODES.INVALID_REFRESH_TOKEN,
      );
    });

    it('does not stretch the cap through the reuse grace window', async () => {
      const { repository, service } = setup(30, '10d');
      const { sessionId, refreshToken: t1 } = await service.createSession({
        userId: 'user-1',
        platform: 'mobile',
      });
      const createdAt = repository.rows.get(sessionId)!.createdAt.getTime();
      jest.advanceTimersByTime(9 * DAY);
      const { refreshToken: t2 } = await service.rotateSession(t1);

      const replay = await service.rotateSession(t1);

      expect(replay.refreshToken).toBe(t2);
      expect(repository.rows.get(sessionId)!.expiresAt.getTime()).toBe(
        createdAt + 10 * DAY,
      );
    });
  });
});
