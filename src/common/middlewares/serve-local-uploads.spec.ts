import { Controller, Get, Logger, Post, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import helmet from 'helmet';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { serveLocalUploads, storeObject } from './processFile';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

/** Guarda un archivo con el req real (trust proxy incluido) y devuelve su URL. */
@Controller('store')
class StoreController {
  @Post()
  async store(@Req() req: Request): Promise<{ url: string }> {
    const url = await storeObject({
      key: 'evidences/stored.webp',
      body: Buffer.from('stored-bytes'),
      contentType: 'image/webp',
      req,
    });
    return { url };
  }
}

/**
 * Mismo orden que main.ts (helmet y despues el static), con archivos reales en
 * disco: las URLs que arma buildLocalPublicUrl tienen que responder y solo esa
 * ruta puede relajar Cross-Origin-Resource-Policy. Solo se publican las
 * carpetas que escribe storeObject, nunca el resto de LOCAL_UPLOAD_DIR.
 */
// Cada test levanta una app Nest real; con la maquina cargada el primero pasaba de 5 s.
jest.setTimeout(30_000);

describe('serveLocalUploads (static de uploads locales, como en main.ts)', () => {
  const envKeys = [
    'LOCAL_UPLOAD_DIR',
    'LOCAL_UPLOAD_PUBLIC_URL',
    'SPACES_UPLOAD_PREFIX',
    'STORAGE_DRIVER',
    'PUBLIC_API_BASE_URL',
    'PAYMENT_CALLBACK_BASE_URL',
    'CORS_ORIGINS',
    'NODE_ENV',
  ] as const;
  let saved: Record<string, string | undefined>;
  let base: string;
  let root: string;
  let app: NestExpressApplication | undefined;
  let errorSpy: jest.SpyInstance;

  beforeAll(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'serve-uploads-'));
    root = path.join(base, 'public');
    mkdirSync(path.join(root, 'evidences'), { recursive: true });
    mkdirSync(path.join(root, 'avatars'), { recursive: true });
    mkdirSync(path.join(root, 'docs', 'evidencias'), { recursive: true });
    mkdirSync(path.join(root, 'dist'), { recursive: true });
    writeFileSync(path.join(root, 'evidences', 'a.webp'), 'webp-bytes');
    writeFileSync(
      path.join(root, 'evidences', 'old.html'),
      '<script>1</script>',
    );
    writeFileSync(path.join(root, 'evidences', '.env'), 'SECRET=1');
    writeFileSync(path.join(root, 'avatars', 'u.webp'), 'avatar-bytes');
    writeFileSync(path.join(root, 'docs', 'evidencias', 'b.pdf'), 'pdf');
    // Dentro de LOCAL_UPLOAD_DIR pero fuera de las carpetas de uploads: lo que
    // quedaria expuesto si la variable apunta a la raiz del proyecto.
    writeFileSync(path.join(root, 'package.json'), '{}');
    writeFileSync(path.join(root, 'dist', 'main.js'), 'code');
    // Fuera de la carpeta servida: no debe alcanzarse con ../
    writeFileSync(path.join(base, 'secret.txt'), 'secret');
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    process.env.LOCAL_UPLOAD_DIR = root;
    delete process.env.LOCAL_UPLOAD_PUBLIC_URL;
    delete process.env.SPACES_UPLOAD_PREFIX;
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.PAYMENT_CALLBACK_BASE_URL;
    delete process.env.CORS_ORIGINS;
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    errorSpy.mockRestore();
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function boot(): Promise<App> {
    const moduleRef = await Test.createTestingModule({
      controllers: [PingController, StoreController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    // Como main.ts: req.host y req.protocol salen de X-Forwarded-*.
    app.set('trust proxy', 1);
    app.use(helmet());
    serveLocalUploads(app);
    await app.init();
    return app.getHttpServer() as App;
  }

  it('serves an evidence at the host root with CORP cross-origin and a pinned type', async () => {
    const server = await boot();
    const res = await request(server).get('/evidences/a.webp').expect(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('serves avatars at the same URL storeObject builds', async () => {
    const server = await boot();
    const res = await request(server).get('/avatars/u.webp').expect(200);
    // image/* llega como Buffer en res.body, no en res.text.
    expect(String(res.body)).toBe('avatar-bytes');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['content-type']).toBe('image/webp');
  });

  it('the rest of the API keeps helmet same-origin', async () => {
    const server = await boot();
    const res = await request(server).get('/ping').expect(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('an old file with an unknown extension is downloaded, never rendered', async () => {
    const server = await boot();
    const res = await request(server).get('/evidences/old.html').expect(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe('attachment');
  });

  it('a missing file or a path outside the folder falls through to 404', async () => {
    const server = await boot();
    await request(server).get('/evidences/missing.webp').expect(404);
    await request(server).get('/%2e%2e/secret.txt').expect(404);
    // Directorio sin index ni redirect.
    await request(server).get('/evidences').expect(404);
  });

  it('files in LOCAL_UPLOAD_DIR outside the upload folders are not published', async () => {
    const server = await boot();
    const res = await request(server).get('/package.json').expect(404);
    // El 404 es el de Nest, no el contenido del archivo.
    expect(res.text).not.toBe('{}');
    await request(server).get('/dist/main.js').expect(404);
    await request(server).get('/evidences/%2e%2e/package.json').expect(404);
    await request(server).get('/avatars/..%2fpackage.json').expect(404);
  });

  it('dotfiles inside an upload folder are ignored', async () => {
    const server = await boot();
    await request(server).get('/evidences/.env').expect(404);
  });

  it('with LOCAL_UPLOAD_PUBLIC_URL it mounts on that path, where the URLs point', async () => {
    process.env.LOCAL_UPLOAD_PUBLIC_URL = 'http://192.168.1.10:3000/uploads/';
    const server = await boot();
    await request(server).get('/uploads/evidences/a.webp').expect(200);
    await request(server).get('/uploads/avatars/u.webp').expect(200);
    await request(server).get('/evidences/a.webp').expect(404);
    await request(server).get('/uploads/package.json').expect(404);
  });

  it('a forged X-Forwarded-Host (trust proxy on) never reaches the stored URL, and that URL is served', async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.PAYMENT_CALLBACK_BASE_URL = 'https://api.larutard.com.do/api/v1';
    const server = await boot();
    const res = await request(server)
      .post('/store')
      .set('X-Forwarded-Host', 'evil.example')
      .set('X-Forwarded-Proto', 'http')
      .expect(201);
    const { url } = res.body as { url: string };
    expect(url).toBe('https://api.larutard.com.do/evidences/stored.webp');
    // La ruta de la URL es la que monta el static, con el archivo real.
    const file = await request(server).get(new URL(url).pathname).expect(200);
    expect(String(file.body)).toBe('stored-bytes');
  });

  it('nothing configured: with trust proxy a forged X-Forwarded-Host is replaced by an allowed origin', async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS =
      'https://conductores.larutard.com.do,https://api.larutard.com.do';
    const server = await boot();

    const forged = await request(server)
      .post('/store')
      .set('X-Forwarded-Host', 'evil.example')
      .set('X-Forwarded-Proto', 'https')
      .expect(201);
    expect((forged.body as { url: string }).url).toBe(
      'https://conductores.larutard.com.do/evidences/stored.webp',
    );

    // El host legitimo que pone nginx sigue funcionando como antes.
    const legit = await request(server)
      .post('/store')
      .set('X-Forwarded-Host', 'api.larutard.com.do')
      .set('X-Forwarded-Proto', 'https')
      .expect(201);
    expect((legit.body as { url: string }).url).toBe(
      'https://api.larutard.com.do/evidences/stored.webp',
    );
  });

  it('a nested SPACES_UPLOAD_PREFIX is served at its own path', async () => {
    process.env.SPACES_UPLOAD_PREFIX = 'docs/evidencias';
    const server = await boot();
    const res = await request(server).get('/docs/evidencias/b.pdf').expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    // La carpeta por defecto ya no es la de evidencias: no se publica.
    await request(server).get('/evidences/a.webp').expect(404);
    await request(server).get('/avatars/u.webp').expect(200);
  });

  it('mounts one static per upload folder with its own root and the hardened options', () => {
    const useStaticAssets = jest.fn();
    serveLocalUploads({ useStaticAssets });
    expect(useStaticAssets).toHaveBeenCalledTimes(2);
    const options = {
      index: false,
      redirect: false,
      fallthrough: true,
      dotfiles: 'ignore',
    };
    expect(useStaticAssets).toHaveBeenNthCalledWith(
      1,
      path.join(root, 'evidences'),
      expect.objectContaining({ prefix: '/evidences', ...options }),
    );
    expect(useStaticAssets).toHaveBeenNthCalledWith(
      2,
      path.join(root, 'avatars'),
      expect.objectContaining({ prefix: '/avatars', ...options }),
    );
  });

  it('skips (and logs) an upload folder that is not a plain relative path', () => {
    process.env.SPACES_UPLOAD_PREFIX = '../outside';
    const useStaticAssets = jest.fn();
    serveLocalUploads({ useStaticAssets });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"../outside"'),
    );
    // avatars se sigue sirviendo.
    expect(useStaticAssets).toHaveBeenCalledTimes(1);
    expect(useStaticAssets).toHaveBeenCalledWith(
      path.join(root, 'avatars'),
      expect.objectContaining({ prefix: '/avatars' }),
    );
  });

  it.each([
    ['the working directory', () => process.cwd()],
    ['a folder that contains it', () => path.dirname(process.cwd())],
  ])(
    'LOCAL_UPLOAD_DIR = %s: logs an error and mounts nothing, without throwing',
    (_label, dir) => {
      process.env.LOCAL_UPLOAD_DIR = dir();
      const useStaticAssets = jest.fn();
      expect(() => serveLocalUploads({ useStaticAssets })).not.toThrow();
      expect(useStaticAssets).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('LOCAL_UPLOAD_DIR');
      expect(errorSpy.mock.calls[0][0]).toContain('NOT served');
    },
  );

  it('LOCAL_UPLOAD_DIR = project root: the app boots and package.json stays private', async () => {
    process.env.LOCAL_UPLOAD_DIR = process.cwd();
    const server = await boot();
    const res = await request(server).get('/package.json').expect(404);
    expect(res.text).not.toContain('"dependencies"');
    await request(server).get('/ping').expect(200);
  });
});
