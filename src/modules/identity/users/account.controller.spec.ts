import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { AccountController, AVATAR_UPLOAD_OPTIONS } from './account.controller';
import { AccountService, AVATAR_MAX_BYTES } from './account.service';

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
    req.user = { id: 'user-1', roles: ['CUSTOMER'] };
    return true;
  }
}

/**
 * Las mismas opciones pero con parts 1: documenta por que AVATAR_UPLOAD_OPTIONS
 * usa 2 (busboy avisa del tope al alcanzarlo y Multer lo trata como error).
 */
@Controller('parts-one')
class PartsOneController {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      ...AVATAR_UPLOAD_OPTIONS,
      limits: { ...AVATAR_UPLOAD_OPTIONS.limits, parts: 1 },
    }),
  )
  upload(@UploadedFile() file: Express.Multer.File | undefined): {
    ok: boolean;
  } {
    return { ok: Boolean(file) };
  }
}

const AVATAR_TYPE_ERROR = {
  code: 'BAD_REQUEST',
  message: 'The avatar must be a JPG, PNG or WebP image',
};

describe('AccountController POST users/me/avatar (multipart limits)', () => {
  let app: INestApplication;
  let server: App;
  const account = { setAvatar: jest.fn(), removeAvatar: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AccountController, PartsOneController],
      providers: [
        { provide: AccountService, useValue: account },
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
    account.setAvatar
      .mockReset()
      .mockResolvedValue({ avatarUrl: 'https://cdn.test/avatars/u.webp' });
  });

  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const avatar = () =>
    request(server).post('/users/me/avatar').set('Authorization', 'Bearer t');

  it('declares one file, no text fields and the image allowlist', () => {
    expect(AVATAR_UPLOAD_OPTIONS.limits).toEqual({
      fileSize: AVATAR_MAX_BYTES,
      files: 1,
      fields: 0,
      parts: 2,
    });
    expect(AVATAR_UPLOAD_OPTIONS.fileFilter).toEqual(expect.any(Function));
  });

  it('401 without token: the multipart is never read', async () => {
    await request(server)
      .post('/users/me/avatar')
      .attach('file', jpeg, { filename: 'me.jpg', contentType: 'image/jpeg' })
      .expect(401);
    expect(account.setAvatar).not.toHaveBeenCalled();
  });

  it.each([
    ['me.jpg', 'image/jpeg'],
    ['me.png', 'image/png'],
    ['me.webp', 'image/webp'],
  ])(
    'one "file" part (what app-customers sends): %s %s reaches the service',
    async (filename, contentType) => {
      const res = await avatar()
        .attach('file', jpeg, { filename, contentType })
        .expect(201);
      expect(res.body).toEqual({
        avatarUrl: 'https://cdn.test/avatars/u.webp',
      });
      expect(account.setAvatar).toHaveBeenCalledTimes(1);
      const [user, file] = account.setAvatar.mock.calls[0] as [
        { id: string },
        Express.Multer.File,
      ];
      expect(user.id).toBe('user-1');
      expect(file.fieldname).toBe('file');
      expect(file.mimetype).toBe(contentType);
      expect(file.buffer).toBeInstanceOf(Buffer);
    },
  );

  it.each([
    ['me.gif', 'image/gif'],
    ['me.svg', 'image/svg+xml'],
    ['cv.pdf', 'application/pdf'],
    ['x.html', 'text/html'],
  ])(
    '%s (%s) is a 400 with the service message, before the service',
    async (filename, contentType) => {
      const res = await avatar()
        .attach('file', jpeg, { filename, contentType })
        .expect(400);
      expect(res.body).toMatchObject({
        success: false,
        error: AVATAR_TYPE_ERROR,
      });
      expect(account.setAvatar).not.toHaveBeenCalled();
    },
  );

  it('any text field is a 400 (fields 0) and the service is never reached', async () => {
    const res = await avatar()
      .field('note', 'x')
      .attach('file', jpeg, { filename: 'me.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Too many fields' },
    });
    expect(account.setAvatar).not.toHaveBeenCalled();
  });

  it('a second file is a 400 (files 1)', async () => {
    const res = await avatar()
      .attach('file', jpeg, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('file', jpeg, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'Too many files',
    );
    expect(account.setAvatar).not.toHaveBeenCalled();
  });

  it('a file under another field name is a 400', async () => {
    const res = await avatar()
      .attach('avatar', jpeg, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'BAD_REQUEST',
    );
    expect(account.setAvatar).not.toHaveBeenCalled();
  });

  it('a file over 2 MB is rejected by Multer (413) before the service', async () => {
    await avatar()
      .attach('file', Buffer.alloc(AVATAR_MAX_BYTES + 1), {
        filename: 'big.jpg',
        contentType: 'image/jpeg',
      })
      .expect(413);
    expect(account.setAvatar).not.toHaveBeenCalled();
  });

  it('without a file the service decides (its own 400 "Attach an image"), as before', async () => {
    // El servicio simulado responde 201; el real da 400 con file undefined.
    await avatar().type('form').send({}).expect(201);
    expect(account.setAvatar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      undefined,
      expect.anything(),
    );
  });

  it('parts 1 would reject the photo itself: that is why the limit is 2', async () => {
    const res = await request(server)
      .post('/parts-one')
      .set('Authorization', 'Bearer t')
      .attach('file', jpeg, { filename: 'me.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'Too many parts',
    );
  });
});
