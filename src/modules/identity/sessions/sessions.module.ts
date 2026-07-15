import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SessionsController } from './sessions.controller';
import { SessionsRepository } from './sessions.repository';
import { SessionsService } from './sessions.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

@Module({
  // Secrets and TTLs are provided per-call by TokenService, so the JwtModule
  // itself carries no static configuration.
  imports: [JwtModule.register({}), PassportModule],
  controllers: [SessionsController],
  providers: [SessionsService, SessionsRepository, TokenService, JwtStrategy],
  exports: [SessionsService, TokenService],
})
export class SessionsModule {}
