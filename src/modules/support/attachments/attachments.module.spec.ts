import { Global, type INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { storageConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { DeliveryProofsModule } from '../delivery-proofs/delivery-proofs.module';
import { DeliveryProofsService } from '../delivery-proofs/delivery-proofs.service';
import { AttachmentsModule } from './attachments.module';
import { AttachmentsService } from './attachments.service';

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: {} }],
  exports: [PrismaService],
})
class FakeDatabaseModule {}

describe('AttachmentsModule wiring', () => {
  let app: INestApplication;
  const previousMax = process.env.MAX_UPLOAD_MB;

  beforeAll(async () => {
    process.env.MAX_UPLOAD_MB = '1';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig],
        }),
        FakeDatabaseModule,
        AttachmentsModule,
        DeliveryProofsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousMax === undefined) delete process.env.MAX_UPLOAD_MB;
    else process.env.MAX_UPLOAD_MB = previousMax;
  });

  it('resolves both services with the shared access helper', () => {
    expect(app.get(AttachmentsService)).toBeInstanceOf(AttachmentsService);
    expect(app.get(DeliveryProofsService)).toBeInstanceOf(
      DeliveryProofsService,
    );
  });

  it('the Multer limit comes from MAX_UPLOAD_MB loaded by ConfigModule', async () => {
    await request(app.getHttpServer() as App)
      .post('/attachments/upload')
      .attach('files', Buffer.alloc(1024 * 1024 + 1), {
        filename: 'big.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
  });
});
