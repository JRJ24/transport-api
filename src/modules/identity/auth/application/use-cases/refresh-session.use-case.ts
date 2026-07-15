import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { RequestContext } from '@/common/interfaces/request-context.interface';
import {
  SessionsService,
  type RotatedSession,
} from '../../../sessions/sessions.service';
import { TokenService } from '../../../sessions/token.service';
import type { AuthTokens } from '../../domain/auth-result.interface';
import { AUTH_AUDIT_ACTIONS, AuthAuditService } from '../auth-audit.service';

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly tokenService: TokenService,
    private readonly audit: AuthAuditService,
  ) {}

  async execute(
    refreshToken: string,
    context: RequestContext,
  ): Promise<AuthTokens> {
    let rotated: RotatedSession;

    try {
      rotated = await this.sessionsService.rotateSession(refreshToken);
    } catch (error) {
      if (
        error instanceof UnauthorizedException &&
        (error.getResponse() as { code?: string }).code ===
          ERROR_CODES.TOKEN_REUSE_DETECTED
      ) {
        await this.audit.record({
          action: AUTH_AUDIT_ACTIONS.REFRESH_REUSE_DETECTED,
          entityType: 'UserSession',
          entityId: 'unknown',
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        });
      }

      throw error;
    }

    const roles = rotated.session.user.userRoles.map(
      (userRole) => userRole.rol.code,
    );

    const accessToken = await this.tokenService.signAccessToken({
      userId: rotated.session.userId,
      sessionId: rotated.session.id,
      roles,
    });

    return {
      accessToken,
      refreshToken: rotated.refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.tokenService.accessTokenTtlSeconds,
    };
  }
}
