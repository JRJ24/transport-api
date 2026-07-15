import type { UserResponse } from '../../users/presenters/user.presenter';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime in seconds */
  expiresIn: number;
}

export interface AuthResult extends AuthTokens {
  user: UserResponse;
  sessionId: string;
}
