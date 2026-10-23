import { Injectable } from '@nestjs/common';
import type { UserSession } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { UserWithRoles } from '../users/presenters/user.presenter';
import { revokeUserSessions } from './session-revocation';

export type SessionWithUser = UserSession & { user: UserWithRoles };

export interface CreateSessionData {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateSessionData): Promise<UserSession> {
    return this.prisma.userSession.create({ data });
  }

  findById(id: string): Promise<UserSession | null> {
    return this.prisma.userSession.findUnique({ where: { id } });
  }

  /**
   * Loads a session only when it is still valid (not revoked, not expired),
   * together with the user and their roles — used on every authenticated
   * request by the JWT strategy.
   */
  findValidWithUser(id: string): Promise<SessionWithUser | null> {
    return this.prisma.userSession.findFirst({
      where: {
        id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: { include: { userRoles: { include: { rol: true } } } },
      },
    });
  }

  /**
   * Atomic refresh-token rotation: succeeds only when the presented hash is
   * still the current one, so two concurrent refreshes can never both win.
   * Keeps the replaced hash and the rotation time for the reuse grace window.
   * Returns the number of updated rows (0 = stale/reused token).
   */
  async rotateRefreshToken(input: {
    sessionId: string;
    currentHash: string;
    nextHash: string;
    expiresAt: Date;
    rotatedAt: Date;
  }): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: {
        id: input.sessionId,
        refreshTokenHash: input.currentHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: input.nextHash,
        previousRefreshTokenHash: input.currentHash,
        refreshRotatedAt: input.rotatedAt,
        expiresAt: input.expiresAt,
        lastActivityAt: new Date(),
      },
    });

    return result.count;
  }

  async touchActivity(id: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id },
      data: { lastActivityAt: new Date() },
    });
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    return revokeUserSessions(this.prisma, userId, exceptSessionId);
  }

  listActiveForUser(userId: string): Promise<UserSession[]> {
    return this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastActivityAt: 'desc' },
    });
  }
}
