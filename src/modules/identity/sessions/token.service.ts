import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ROLES } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { TokenType } from '@/common/enums/token-type.enum';
import type {
  JwtPayload,
  RefreshJwtPayload,
} from '@/common/interfaces/jwt-payload.interface';
import { durationToSeconds } from '@/common/utils/date.util';
import { authConfig } from '@/config';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  get accessTokenTtlSeconds(): number {
    return durationToSeconds(this.auth.accessTtl);
  }

  signAccessToken(input: {
    userId: string;
    sessionId: string;
    roles: ROLES[];
  }): Promise<string> {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: input.userId,
      sessionId: input.sessionId,
      roles: input.roles,
      type: TokenType.ACCESS,
    };

    return this.jwtService.signAsync(payload, {
      secret: this.auth.accessSecret,
      expiresIn: durationToSeconds(this.auth.accessTtl),
    });
  }

  signRefreshToken(input: {
    userId: string;
    sessionId: string;
    ttl: string;
  }): Promise<string> {
    const payload: Omit<RefreshJwtPayload, 'iat' | 'exp'> = {
      sub: input.userId,
      sessionId: input.sessionId,
      type: TokenType.REFRESH,
    };

    return this.jwtService.signAsync(payload, {
      secret: this.auth.refreshSecret,
      expiresIn: durationToSeconds(input.ttl),
    });
  }

  async verifyRefreshToken(token: string): Promise<RefreshJwtPayload> {
    let payload: RefreshJwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshJwtPayload>(token, {
        secret: this.auth.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_REFRESH_TOKEN,
        message: 'Invalid or expired refresh token',
      });
    }

    if (payload.type !== TokenType.REFRESH) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_REFRESH_TOKEN,
        message: 'Invalid or expired refresh token',
      });
    }

    return payload;
  }
}
