import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import { NotificationsModule } from '@/modules/support/notifications/notifications.module';
import { IncidentsModule } from './incidents.module';
import { IncidentsService } from './incidents.service';

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: RealtimeService, useValue: {} },
  ],
  exports: [PrismaService, RealtimeService],
})
class FakeGlobalsModule {}

/** NotificationsModule real arrastra Firebase y la cola; aqui solo importa el dispatcher. */
@Module({
  providers: [{ provide: NotificationDispatcherService, useValue: {} }],
  exports: [NotificationDispatcherService],
})
class FakeNotificationsModule {}

describe('IncidentsModule wiring', () => {
  it('resolves IncidentsService with the shared EvidenceAccessService', async () => {
    // Sin EvidenceAccessModule en imports, Nest no puede resolver el cuarto
    // argumento de IncidentsService y la app no arranca.
    const moduleRef = await Test.createTestingModule({
      imports: [FakeGlobalsModule, IncidentsModule],
    })
      .overrideModule(NotificationsModule)
      .useModule(FakeNotificationsModule)
      .compile();

    expect(moduleRef.get(IncidentsService)).toBeInstanceOf(IncidentsService);
    await moduleRef.close();
  });
});
