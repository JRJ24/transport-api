import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SessionsModule } from '@/modules/identity/sessions/sessions.module';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  imports: [JwtModule.register({}), SessionsModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
