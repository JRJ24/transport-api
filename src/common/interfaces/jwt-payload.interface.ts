import type { ROLES } from '@generated/prisma/enums';
import type { TokenType } from '../enums/token-type.enum';

export interface JwtPayload {
  /** User id */
  sub: string;
  sessionId: string;
  roles: ROLES[];
  type: TokenType.ACCESS;
  iat?: number;
  exp?: number;
}

export interface RefreshJwtPayload {
  /** User id */
  sub: string;
  sessionId: string;
  type: TokenType.REFRESH;
  iat?: number;
  exp?: number;
}
