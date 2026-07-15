import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';

export const AUTH_AUDIT_ACTIONS = {
  LOGIN: 'auth.login',
  LOGIN_FAILED: 'auth.login_failed',
  REGISTER: 'auth.register',
  REFRESH_REUSE_DETECTED: 'auth.refresh_reuse_detected',
  LOGOUT: 'auth.logout',
  LOGOUT_ALL: 'auth.logout_all',
} as const;

export type AuthAuditAction =
  (typeof AUTH_AUDIT_ACTIONS)[keyof typeof AUTH_AUDIT_ACTIONS];

export interface AuthAuditEntry {
  action: AuthAuditAction;
  actorUserId?: string;
  entityType: string;
  entityId: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Best-effort audit trail: a failure to persist the audit row must never
   * break the authentication flow itself.
   */
  async record(entry: AuthAuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorUserId: entry.actorUserId ?? null,
          entityType: entry.entityType,
          entityId: entry.entityId,
          newValues: entry.metadata
            ? (entry.metadata as Prisma.InputJsonValue)
            : undefined,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not persist audit entry "${entry.action}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
