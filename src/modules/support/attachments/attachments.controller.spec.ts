import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { buildEvidenceUploadOptions } from './upload-options';

/** Hace de JwtAuthGuard: los guards globales corren antes que el interceptor. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: unknown }>();
    if (!req.headers.authorization) {
      throw new UnauthorizedException();
    }
    req.user = { id: 'user-1', roles: ['DRIVER'] };
    return true;
  }
}

describe('AttachmentsController upload (multipart contract)', () => {
  let app: INestApplication;
  let server: App;
  const service = { upload: jest.fn(), list: jest.fn(), create: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MulterModule.register(buildEvidenceUploadOptions(1))],
      controllers: [AttachmentsController],
      providers: [
        { provide: AttachmentsService, useValue: service },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    server = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.upload.mockReset().mockResolvedValue([]);
  });

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

  it('401 without token: the service (and so the storage) is never reached', async () => {
    await request(server)
      .post('/attachments/upload')
      .field('entityType', 'DeliveryProof')
      .field('entityId', 'proof-1')
      .attach('files', jpeg, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(401);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('passes the files of field "files" and the text fields as the DTO, like the apps send them', async () => {
    await request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      // app-customers manda primero los archivos y despues los campos.
      .attach('files', jpeg, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .attach('files', jpeg, {
        filename: 'signature.png',
        contentType: 'image/png',
      })
      .field('entityType', 'DeliveryProof')
      .field('entityId', 'proof-1')
      .expect(201);

    expect(service.upload).toHaveBeenCalledTimes(1);
    const [user, files, dto] = service.upload.mock.calls[0] as [
      { id: string },
      Express.Multer.File[],
      Record<string, unknown>,
    ];
    expect(user.id).toBe('user-1');
    expect(files.map((f) => [f.fieldname, f.originalname])).toEqual([
      ['files', 'photo.jpg'],
      ['files', 'signature.png'],
    ]);
    // En memoria: nada se escribio todavia.
    expect(files[0].buffer).toBeInstanceOf(Buffer);
    expect({ ...dto }).toEqual({
      entityType: 'DeliveryProof',
      entityId: 'proof-1',
    });
  });

  it('upload without entity fields is accepted (file only)', async () => {
    await request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      .attach('files', jpeg, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    expect({ ...(service.upload.mock.calls[0][2] as object) }).toEqual({});
  });

  it('an unknown text field is rejected by forbidNonWhitelisted', async () => {
    const res = await request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      .field('entityType', 'DeliveryProof')
      .field('uploadedFiles', 'spoofed')
      .attach('files', jpeg, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('a type outside the allowlist is a 400 with the standard envelope', async () => {
    const res = await request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      .attach('files', Buffer.from('<script>'), {
        filename: 'x.html',
        contentType: 'text/html',
      })
      .expect(400);
    expect(res.body).toMatchObject({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Formato no soportado para evidencias.',
      },
    });
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('a file over MAX_UPLOAD_MB is rejected before reaching the service', async () => {
    await request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      .attach('files', Buffer.alloc(1024 * 1024 + 1), {
        filename: 'big.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
    expect(service.upload).not.toHaveBeenCalled();
  });
});
