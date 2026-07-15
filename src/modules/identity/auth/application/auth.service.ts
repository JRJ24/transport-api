import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { RequestContext } from '@/common/interfaces/request-context.interface';
import type { AuthResult, AuthTokens } from '../domain/auth-result.interface';
import type { LoginDto } from '../presentation/dto/login.dto';
import type { RegisterDto } from '../presentation/dto/register.dto';
import { LoginUseCase } from './use-cases/login.use-case';
import { LogoutAllUseCase } from './use-cases/logout-all.use-case';
import { LogoutUseCase } from './use-cases/logout.use-case';
import { RefreshSessionUseCase } from './use-cases/refresh-session.use-case';
import { RegisterUseCase } from './use-cases/register.use-case';

/**
 * Facade over the auth use-cases so the controller depends on a single
 * application service.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly registerUseCase: RegisterUseCase,
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly logoutAllUseCase: LogoutAllUseCase,
  ) {}

  login(dto: LoginDto, context: RequestContext): Promise<AuthResult> {
    return this.loginUseCase.execute(dto, context);
  }

  register(dto: RegisterDto, context: RequestContext): Promise<AuthResult> {
    return this.registerUseCase.execute(dto, context);
  }

  refresh(refreshToken: string, context: RequestContext): Promise<AuthTokens> {
    return this.refreshSessionUseCase.execute(refreshToken, context);
  }

  logout(user: AuthenticatedUser, context: RequestContext): Promise<void> {
    return this.logoutUseCase.execute(user, context);
  }

  logoutAll(
    user: AuthenticatedUser,
    context: RequestContext,
  ): Promise<{ revokedCount: number }> {
    return this.logoutAllUseCase.execute(user, context);
  }
}
