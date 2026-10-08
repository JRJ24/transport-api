import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import helmet from 'helmet';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { serveLocalUploads } from './processFile';

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

/**
 * Mismo orden que main.ts (helmet y despues el static), con archivos reales en
 * disco: las URLs que arma buildLocalPublicUrl tienen que responder y solo esa
 * ruta puede relajar Cross-Origin-Resource-Policy.
 */
describe('serveLocalUploads (static de uploads locales, como en main.ts)', () => {
  const envKeys = ['LOCAL_UPLOAD_DIR', 'LOCAL_UPLOAD_PUBLIC_URL'] as const;
  let saved: Record<string, string | undefined>;
  let base: string;
  let root: string;
  let app: NestExpressApplication | undefined;

  beforeAll(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'serve-uploads-'));
    root = path.join(base, 'public');
    mkdirSync(path.join(root, 'evidences'), { recursive: true });
    writeFileSync(path.join(root, 'evidences', 'a.webp'), 'webp-bytes');
    writeFileSync(
      path.join(root, 'evidences', 'old.html'),
      '<script>1</script>',
    );
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
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function boot(): Promise<App> {
    const moduleRef = await Test.createTestingModule({
      controllers: [PingController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
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

  it('with LOCAL_UPLOAD_PUBLIC_URL it mounts on that path, where the URLs point', async () => {
    process.env.LOCAL_UPLOAD_PUBLIC_URL = 'http://192.168.1.10:3000/uploads/';
    const server = await boot();
    await request(server).get('/uploads/evidences/a.webp').expect(200);
    await request(server).get('/evidences/a.webp').expect(404);
  });
});
