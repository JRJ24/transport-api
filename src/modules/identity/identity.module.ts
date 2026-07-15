import { Module } from '@nestjs/common';
import { AddressesModule } from './addresses/addresses.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { SessionsModule } from './sessions/sessions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    UsersModule,
    RolesModule,
    SessionsModule,
    AuthModule,
    AddressesModule,
  ],
})
export class IdentityModule {}
