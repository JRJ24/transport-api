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
import { RolesGuard } from '@/common/guards/roles.guard';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import {
  buildEvidenceUploadOptions,
  MAX_FILES_PER_UPLOAD,
} from './upload-options';

/**
 * Hace de JwtAuthGuard: los guards globales corren antes que el interceptor.
 * Roles por la cabecera x-test-roles (por defecto DRIVER).
 */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: unknown }>();
    if (!req.headers.authorization) {
      throw new UnauthorizedException();
    }
    const roles = (req.headers['x-test-roles'] ?? 'DRIVER').split(',');
    req.user = { id: 'user-1', roles };
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
        // Mismo orden que app.module: autenticacion y despues roles.
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
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
    service.list.mockReset().mockResolvedValue([]);
    service.create.mockReset().mockResolvedValue({ id: 'att-1' });
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

  // El DTO deja los dos campos opcionales: quien decide es el servicio (400
  // para conductor y cliente, solo el archivo para staff; ver
  // attachments.service.spec).
  it('upload without entity fields reaches the service with an empty DTO (staff file-only upload)', async () => {
    await request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      .set('x-test-roles', 'ADMIN')
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

  it(`accepts up to ${MAX_FILES_PER_UPLOAD} files (the apps send 2)`, async () => {
    expect(MAX_FILES_PER_UPLOAD).toBe(5);
    let call = request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      .field('entityType', 'DeliveryProof')
      .field('entityId', 'proof-1');
    for (let i = 0; i < MAX_FILES_PER_UPLOAD; i++) {
      call = call.attach('files', jpeg, {
        filename: `photo-${i}.jpg`,
        contentType: 'image/jpeg',
      });
    }
    await call.expect(201);
    expect(
      (service.upload.mock.calls[0][1] as Express.Multer.File[]).length,
    ).toBe(MAX_FILES_PER_UPLOAD);
  });

  it('one file over the per-request limit is a 400 and the service is never reached', async () => {
    let call = request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      .field('entityType', 'DeliveryProof')
      .field('entityId', 'proof-1');
    for (let i = 0; i <= MAX_FILES_PER_UPLOAD; i++) {
      call = call.attach('files', jpeg, {
        filename: `photo-${i}.jpg`,
        contentType: 'image/jpeg',
      });
    }
    const res = await call.expect(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Too many files' },
    });
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('too many text fields is a 400 before reaching the service', async () => {
    let call = request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t');
    for (let i = 0; i < 6; i++) {
      call = call.field(`f${i}`, 'x');
    }
    const res = await call
      .attach('files', jpeg, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'Too many fields',
    );
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('a text field over 1 KB is a 400 before reaching the service', async () => {
    const res = await request(server)
      .post('/attachments/upload')
      .set('Authorization', 'Bearer t')
      .field('entityType', 'DeliveryProof')
      .field('entityId', 'x'.repeat(1025))
      .attach('files', jpeg, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'Field value too long - entityId',
    );
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

describe('AttachmentsController metadata and list contract', () => {
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
        { provide: APP_GUARD, useClass: RolesGuard },
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
    service.list.mockReset().mockResolvedValue([]);
    service.create.mockReset().mockResolvedValue({ id: 'att-1' });
  });

  const metadata = {
    entityType: 'Incident',
    entityId: 'inc-1',
    fileName: 'doc.pdf',
    fileUrl: 'https://cdn.test/doc.pdf',
    fileSize: 10,
    mimeType: 'application/pdf',
  };

  it.each(['DRIVER', 'CUSTOMER'])(
    'POST /attachments as %s: 403 FORBIDDEN_ROLE, the service is never reached',
    async (role) => {
      const res = await request(server)
        .post('/attachments')
        .set('Authorization', 'Bearer t')
        .set('x-test-roles', role)
        .send(metadata)
        .expect(403);
      expect((res.body as { error: { code: string } }).error.code).toBe(
        'FORBIDDEN_ROLE',
      );
      expect(service.create).not.toHaveBeenCalled();
    },
  );

  it.each(['ADMIN', 'OPERATOR', 'DRIVER,OPERATOR'])(
    'POST /attachments as %s reaches the service',
    async (roles) => {
      await request(server)
        .post('/attachments')
        .set('Authorization', 'Bearer t')
        .set('x-test-roles', roles)
        .send(metadata)
        .expect(201);
      expect(service.create).toHaveBeenCalledTimes(1);
    },
  );

  it('GET /attachments passes entityType and entityId as the apps send them', async () => {
    await request(server)
      .get('/attachments')
      .query({ entityType: 'DeliveryProof', entityId: 'proof-1' })
      .set('Authorization', 'Bearer t')
      .expect(200);
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'DeliveryProof',
      'proof-1',
    );
  });

  it('GET /attachments without filters still reaches the service (staff lists freely)', async () => {
    await request(server)
      .get('/attachments')
      .set('Authorization', 'Bearer t')
      .set('x-test-roles', 'ADMIN')
      .expect(200);
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      undefined,
      undefined,
    );
  });

  it('GET /attachments with an unknown query param is a 400 (forbidNonWhitelisted)', async () => {
    const res = await request(server)
      .get('/attachments')
      .query({ entityType: 'DeliveryProof', entityId: 'proof-1', limit: 5 })
      .set('Authorization', 'Bearer t')
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(service.list).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a repeated entityType (array)',
      'entityType=a1&entityType=b2&entityId=p1',
    ],
    ['a one-char entityType', 'entityType=a&entityId=proof-1'],
    [
      'an entityId over 120 chars',
      `entityType=Order&entityId=${'x'.repeat(121)}`,
    ],
  ])('GET /attachments with %s is a 400', async (_label, qs) => {
    const res = await request(server)
      .get(`/attachments?${qs}`)
      .set('Authorization', 'Bearer t')
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(service.list).not.toHaveBeenCalled();
  });
});
