import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { RequestContext } from '@/common/interfaces/request-context.interface';
import { SessionsService } from '../../../sessions/sessions.service';
import { AUTH_AUDIT_ACTIONS, AuthAuditService } from '../auth-audit.service';

@Injectable()
export class LogoutAllUseCase {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly audit: AuthAuditService,
  ) {}

  async execute(
    user: AuthenticatedUser,
    context: RequestContext,
  ): Promise<{ revokedCount: number }> {
    const revokedCount = await this.sessionsService.revokeAllForUser(user.id);

    await this.audit.record({
      action: AUTH_AUDIT_ACTIONS.LOGOUT_ALL,
      actorUserId: user.id,
      entityType: 'User',
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { revokedCount },
    });

    return { revokedCount };
  }
}
