import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/support/notifications/notifications.module';
import { EvidenceAccessModule } from '../evidence-access/evidence-access.module';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

@Module({
  // EvidenceAccessModule: la misma regla de "orden propia" que pruebas y
  // adjuntos, para que conductor y cliente solo toquen incidencias suyas.
  imports: [NotificationsModule, EvidenceAccessModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
})
export class IncidentsModule {}
