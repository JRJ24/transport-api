import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@/common/interfaces/request-context.interface';
import { SessionsService } from '../../sessions/sessions.service';
import { TokenService } from '../../sessions/token.service';
import {
  toUserResponse,
  type UserWithRoles,
} from '../../users/presenters/user.presenter';
import type { AuthResult } from '../domain/auth-result.interface';

export interface DeviceInfo {
  platform?: string;
  deviceId?: string;
  deviceName?: string;
}

/**
 * Shared by login and register: opens a session for the user and signs the
 * access/refresh token pair.
 */
@Injectable()
export class AuthSessionIssuer {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly tokenService: TokenService,
  ) {}

  async issue(
    user: UserWithRoles,
    device: DeviceInfo,
    context: RequestContext,
  ): Promise<AuthResult> {
    const roles = user.userRoles.map((userRole) => userRole.rol.code);

    const issued = await this.sessionsService.createSession({
      userId: user.id,
      platform: device.platform,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const accessToken = await this.tokenService.signAccessToken({
      userId: user.id,
      sessionId: issued.sessionId,
      roles,
    });

    return {
      user: toUserResponse(user),
      sessionId: issued.sessionId,
      accessToken,
      refreshToken: issued.refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.tokenService.accessTokenTtlSeconds,
    };
  }
}
