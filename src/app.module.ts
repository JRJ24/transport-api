import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { IncomingMessage, ServerResponse } from 'http';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { AccountStatusGuard } from './common/guards/account-status.guard';
import { DriverVerificationGuard } from './common/guards/driver-verification.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { REQUEST_ID_HEADER } from './common/constants/request.constant';
import { appConfig, configLoaders, validateEnv } from './config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { AdministrationModule } from './modules/administration/administration.module';
import { BillingModule } from './modules/billing/billing.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OperationsModule } from './modules/operations/operations.module';
import { PublicModule } from './modules/public/public.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { SupportModule } from './modules/support/support.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TransportModule } from './modules/transport/transport.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      load: configLoaders,
    }),

    LoggerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (app: ConfigType<typeof appConfig>) => ({
        pinoHttp: {
          level: app.logLevel,
          // Correlation id: honors an incoming x-request-id, otherwise mints
          // one, and always echoes it back on the response.
          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const header = req.headers[REQUEST_ID_HEADER];
            const id =
              typeof header === 'string' && header.length > 0
                ? header
                : randomUUID();
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          transport:
            app.nodeEnv === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (app: ConfigType<typeof appConfig>) => ({
        throttlers: [
          {
            name: 'default',
            ttl: app.throttleTtlMs,
            limit: app.throttleLimit,
          },
        ],
      }),
    }),

    DatabaseModule,

    PublicModule,
    IdentityModule,
    TransportModule,
    OperationsModule,
    RealtimeModule,
    TrackingModule,
    BillingModule,
    SupportModule,
    AdministrationModule,
  ],
  controllers: [HealthController],
  providers: [
    // Guard order matters: rate limit → authentication → account status →
    // authorization (roles, then fine-grained permissions).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccountStatusGuard },
    { provide: APP_GUARD, useClass: DriverVerificationGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Catch-all first; the Prisma filter (more specific) wins when it matches.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
