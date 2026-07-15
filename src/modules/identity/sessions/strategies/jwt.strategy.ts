import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { TokenType } from '@/common/enums/token-type.enum';
import { permissionsForRoles } from '@/common/enums/permission.enum';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { JwtPayload } from '@/common/interfaces/jwt-payload.interface';
import { authConfig } from '@/config';
import { SessionsService } from '../sessions.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(authConfig.KEY)
    auth: ConfigType<typeof authConfig>,
    private readonly sessionsService: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.accessSecret,
    });
  }

  /**
   * Runs on every authenticated request. Beyond the JWT signature/expiry
   * (already verified by passport-jwt), it requires the session to still be
   * alive — this is what makes server-side revocation effective immediately.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== TokenType.ACCESS) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid token type',
      });
    }

    const session = await this.sessionsService.findValidWithUser(
      payload.sessionId,
    );

    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException({
        code: ERROR_CODES.SESSION_REVOKED,
        message: 'Session is no longer valid',
      });
    }

    this.sessionsService.touchActivityThrottled(session);

    const roles = session.user.userRoles.map((userRole) => userRole.rol.code);

    return {
      id: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      status: session.user.status,
      roles,
      permissions: permissionsForRoles(roles),
      sessionId: session.id,
    };
  }
}
