import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [SessionsModule],
  controllers: [AccountController, UsersController],
  providers: [UsersService, AccountService],
  exports: [UsersService],
})
export class UsersModule {}
