import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { AuthAuditService } from './application/auth-audit.service';
import { AuthSessionIssuer } from './application/auth-session.issuer';
import { AuthService } from './application/auth.service';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutAllUseCase } from './application/use-cases/logout-all.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { AuthController } from './presentation/auth.controller';

@Module({
  imports: [UsersModule, SessionsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionIssuer,
    AuthAuditService,
    LoginUseCase,
    RegisterUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    LogoutAllUseCase,
  ],
})
export class AuthModule {}
