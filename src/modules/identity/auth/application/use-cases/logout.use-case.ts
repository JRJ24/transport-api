import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { RequestContext } from '@/common/interfaces/request-context.interface';
import { SessionsService } from '../../../sessions/sessions.service';
import { AUTH_AUDIT_ACTIONS, AuthAuditService } from '../auth-audit.service';

@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly audit: AuthAuditService,
  ) {}

  async execute(
    user: AuthenticatedUser,
    context: RequestContext,
  ): Promise<void> {
    await this.sessionsService.revokeSession(user.sessionId);

    await this.audit.record({
      action: AUTH_AUDIT_ACTIONS.LOGOUT,
      actorUserId: user.id,
      entityType: 'UserSession',
      entityId: user.sessionId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }
}
