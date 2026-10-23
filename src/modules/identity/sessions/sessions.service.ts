import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { UserSession } from '@generated/prisma/client';
import { ROLES, STATUS_ACCOUNT } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { addDuration, durationToMs } from '@/common/utils/date.util';
import { sha256 } from '@/common/utils/hash.util';
import { authConfig } from '@/config';
import {
  SessionsRepository,
  type SessionWithUser,
} from './sessions.repository';
import { TokenService } from './token.service';

const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60_000;

export interface CreateSessionInput {
  userId: string;
  platform?: string;
  deviceId?: string;
  deviceName?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface RotatedSession {
  session: SessionWithUser;
  refreshToken: string;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly repository: SessionsRepository,
    private readonly tokenService: TokenService,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  private refreshTtlFor(platform?: string): string {
    return platform === 'web'
      ? this.auth.refreshTtlWeb
      : this.auth.refreshTtlMobile;
  }

  /** Sessions created before this are past the absolute lifetime cap. */
  private sessionCutoff(): Date {
    return new Date(Date.now() - durationToMs(this.auth.sessionMaxAge));
  }

  /** Sliding expiry, never beyond `createdAt` + the absolute cap. */
  private nextExpiry(createdAt: Date, ttl: string): Date {
    const sliding = addDuration(new Date(), ttl);
    const cap = new Date(
      createdAt.getTime() + durationToMs(this.auth.sessionMaxAge),
    );
    return sliding < cap ? sliding : cap;
  }

  async createSession(input: CreateSessionInput): Promise<IssuedSession> {
    const ttl = this.refreshTtlFor(input.platform);
    const expiresAt = this.nextExpiry(new Date(), ttl);
    const sessionId = randomUUID();

    const refreshToken = await this.tokenService.signRefreshToken({
      userId: input.userId,
      sessionId,
      ttl,
    });

    await this.repository.create({
      id: sessionId,
      userId: input.userId,
      refreshTokenHash: sha256(refreshToken),
      expiresAt,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      platform: input.platform,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return { sessionId, refreshToken, expiresAt };
  }

  /**
   * Rotating refresh: verifies the token, requires it to be the CURRENT one
   * for a live session, then atomically replaces it. Presenting an already
   * rotated token is treated as theft/replay and revokes the whole session,
   * except for the immediately previous token inside the grace window: that
   * is a concurrent refresh (two tabs, retries) and gets the current token.
   */
  async rotateSession(refreshToken: string): Promise<RotatedSession> {
    const payload = await this.tokenService.verifyRefreshToken(refreshToken);

    const session = await this.repository.findValidWithUser(
      payload.sessionId,
      this.sessionCutoff(),
    );

    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_REFRESH_TOKEN,
        message: 'Session is no longer valid',
      });
    }

    // A blocked or inactive account loses this session for good, so it does
    // not come back if the account is reactivated. Same codes as login.
    if (session.user.status !== STATUS_ACCOUNT.ACTIVE) {
      await this.repository.revoke(session.id);
      throw new ForbiddenException(
        session.user.status === STATUS_ACCOUNT.BLOCKED
          ? { code: ERROR_CODES.ACCOUNT_BLOCKED, message: 'Account is blocked' }
          : {
              code: ERROR_CODES.ACCOUNT_INACTIVE,
              message: 'Account is not active',
            },
      );
    }

    const ttl = this.refreshTtlFor(session.platform ?? undefined);
    // Signing with an explicit iat makes the token reproducible for the grace path.
    const issuedAt = Math.floor(Date.now() / 1000);
    const nextRefreshToken = await this.tokenService.signRefreshToken({
      userId: session.userId,
      sessionId: session.id,
      ttl,
      issuedAt,
    });
    const presentedHash = sha256(refreshToken);

    const rotated = await this.repository.rotateRefreshToken({
      sessionId: session.id,
      currentHash: presentedHash,
      nextHash: sha256(nextRefreshToken),
      expiresAt: this.nextExpiry(session.createdAt, ttl),
      rotatedAt: new Date(issuedAt * 1000),
    });

    if (rotated === 0) {
      const graceToken = await this.currentTokenWithinGrace(
        session.id,
        presentedHash,
      );

      if (graceToken) {
        return { session, refreshToken: graceToken };
      }

      await this.repository.revoke(session.id);
      this.logger.warn(
        `Refresh token reuse detected for session ${session.id} (user ${session.userId}); session revoked`,
      );
      throw new UnauthorizedException({
        code: ERROR_CODES.TOKEN_REUSE_DETECTED,
        message: 'Refresh token reuse detected; the session was revoked',
      });
    }

    return { session, refreshToken: nextRefreshToken };
  }

  /**
   * Returns the CURRENT refresh token when `presentedHash` is the token it
   * replaced and the rotation happened within the grace window; null when the
   * grace does not apply. The current token is never stored: it is re-signed
   * with its original iat (HS256 is deterministic) and checked against the
   * stored hash. Read-only, so concurrent grace requests are idempotent.
   */
  private async currentTokenWithinGrace(
    sessionId: string,
    presentedHash: string,
  ): Promise<string | null> {
    const graceMs = this.auth.refreshReuseGraceSeconds * 1000;
    const session = await this.repository.findById(sessionId);

    if (
      graceMs <= 0 ||
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.refreshRotatedAt ||
      session.previousRefreshTokenHash !== presentedHash ||
      Date.now() - session.refreshRotatedAt.getTime() > graceMs
    ) {
      return null;
    }

    const currentToken = await this.tokenService.signRefreshToken({
      userId: session.userId,
      sessionId: session.id,
      ttl: this.refreshTtlFor(session.platform ?? undefined),
      issuedAt: Math.floor(session.refreshRotatedAt.getTime() / 1000),
    });

    if (sha256(currentToken) !== session.refreshTokenHash) {
      // Secret or TTL changed mid-window: refuse, but this is not theft.
      this.logger.warn(
        `Refresh grace for session ${session.id} could not reproduce the current token`,
      );
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_REFRESH_TOKEN,
        message: 'Session is no longer valid',
      });
    }

    this.logger.debug(
      `Concurrent refresh within grace for session ${session.id}`,
    );
    return currentToken;
  }

  findValidWithUser(sessionId: string): Promise<SessionWithUser | null> {
    return this.repository.findValidWithUser(sessionId, this.sessionCutoff());
  }

  /**
   * Updates lastActivityAt at most once every 5 minutes, fire-and-forget,
   * so authenticated requests do not pay a write on every hit.
   */
  touchActivityThrottled(session: UserSession): void {
    const elapsed = Date.now() - session.lastActivityAt.getTime();

    if (elapsed < ACTIVITY_TOUCH_INTERVAL_MS) {
      return;
    }

    void this.repository.touchActivity(session.id).catch((error: Error) => {
      this.logger.warn(
        `Could not update session activity for ${session.id}: ${error.message}`,
      );
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.repository.revoke(sessionId);
  }

  /**
   * Revokes a session on behalf of a user: owners can revoke their own
   * sessions, admins can revoke anyone's.
   */
  async revokeSessionFor(
    sessionId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const session = await this.repository.findById(sessionId);

    if (!session) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Session not found',
      });
    }

    const isOwner = session.userId === actor.id;
    const isAdmin = actor.roles.includes(ROLES.ADMIN);

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You cannot revoke this session',
      });
    }

    await this.repository.revoke(sessionId);
  }

  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    return this.repository.revokeAllForUser(userId, exceptSessionId);
  }

  listSessions(userId: string): Promise<UserSession[]> {
    return this.repository.listActiveForUser(userId, this.sessionCutoff());
  }
}
