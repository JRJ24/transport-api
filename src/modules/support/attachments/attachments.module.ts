import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { storageConfig } from '@/config';
import { EvidenceAccessModule } from '../evidence-access/evidence-access.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { buildEvidenceUploadOptions } from './upload-options';

@Module({
  imports: [
    EvidenceAccessModule,
    // Async para leer MAX_UPLOAD_MB ya cargado del .env (el middleware viejo
    // lo leia al importar, antes de que ConfigModule lo cargara).
    MulterModule.registerAsync({
      inject: [storageConfig.KEY],
      useFactory: (storage: ConfigType<typeof storageConfig>) =>
        buildEvidenceUploadOptions(storage.maxUploadMb),
    }),
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
