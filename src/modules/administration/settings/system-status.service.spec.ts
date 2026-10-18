import { Logger } from '@nestjs/common';
import os from 'os';
import path from 'path';
import type { PrismaService } from '@/database/prisma.service';
import type { RedisService } from '@/database/redis.service';
import { SystemStatusService } from './system-status.service';

const STORAGE_ENV = [
  'STORAGE_DRIVER',
  'SPACES_NAME',
  'SPACES_BUCKET',
  'S3_BUCKET',
  'ACCESS_KEY_NAME',
  'SPACES_ACCESS_KEY_ID',
  'ACCESS_KEY_ID',
  'SPACES_SECRET_ACCESS_KEY',
  'ACCESS_SECRET_KEY',
  'SPACES_REGION',
  'SPACES_UPLOAD_PREFIX',
  'LOCAL_UPLOAD_DIR',
];

let savedEnv: Record<string, string | undefined>;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  savedEnv = Object.fromEntries(STORAGE_ENV.map((k) => [k, process.env[k]]));
  for (const key of STORAGE_ENV) delete process.env[key];
  // Una carpeta dedicada fuera del proyecto, como en produccion.
  process.env.LOCAL_UPLOAD_DIR = path.join(os.tmpdir(), 'ruta-uploads');
  // resolveStorageTarget avisa al caer a disco; aqui no interesa el log.
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
});

afterEach(() => {
  for (const key of STORAGE_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  warnSpy.mockRestore();
});

function buildService(): SystemStatusService {
  return new SystemStatusService(
    { $queryRaw: jest.fn().mockResolvedValue([1]) } as unknown as PrismaService,
    { client: null } as unknown as RedisService,
    { useMocks: false, serverApiKey: 'maps-key' } as never,
    {
      defaultProvider: 'cardnet',
      cardnetEnvironment: 'production',
      azulEnvironment: 'sandbox',
    } as never,
    {
      pushEnabled: true,
      firebaseProjectId: 'ruta',
      smtpHost: 'smtp.test',
    } as never,
  );
}

async function storageCheck() {
  const { checks } = await buildService().checks();
  const check = checks.find((item) => item.id === 'storage');
  expect(check).toBeDefined();
  return check;
}

const spacesEnv = () => {
  process.env.STORAGE_DRIVER = 'spaces';
  process.env.SPACES_BUCKET = 'ruta-evidences';
  process.env.SPACES_ACCESS_KEY_ID = 'key';
  process.env.SPACES_SECRET_ACCESS_KEY = 'secret';
};

describe('SystemStatusService storage check (real target of storeObject)', () => {
  it('bucket and credentials -> ok with the bucket and the region the client uses', async () => {
    spacesEnv();
    process.env.SPACES_REGION = 'sfo3';
    expect(await storageCheck()).toEqual({
      id: 'storage',
      label: 'Almacenamiento de evidencias',
      state: 'ok',
      detail: 'Bucket ruta-evidences (sfo3)',
    });
  });

  it('the bucket from SPACES_NAME counts, like in storeObject', async () => {
    spacesEnv();
    delete process.env.SPACES_BUCKET;
    process.env.SPACES_NAME = 'ruta-prod';
    expect(await storageCheck()).toMatchObject({
      state: 'ok',
      detail: 'Bucket ruta-prod (nyc3)',
    });
  });

  it('bucket without credentials (the old false OK) -> error: files go to local disk', async () => {
    spacesEnv();
    delete process.env.SPACES_ACCESS_KEY_ID;
    delete process.env.SPACES_SECRET_ACCESS_KEY;
    expect(await storageCheck()).toEqual({
      id: 'storage',
      label: 'Almacenamiento de evidencias',
      state: 'error',
      detail:
        'Falta SPACES_ACCESS_KEY_ID, SPACES_SECRET_ACCESS_KEY: las evidencias se guardan en el disco local del servidor',
    });
  });

  it('no bucket -> error naming what is missing', async () => {
    process.env.STORAGE_DRIVER = 's3';
    process.env.SPACES_ACCESS_KEY_ID = 'key';
    process.env.SPACES_SECRET_ACCESS_KEY = 'secret';
    expect(await storageCheck()).toMatchObject({
      state: 'error',
      detail:
        'Falta SPACES_BUCKET: las evidencias se guardan en el disco local del servidor',
    });
  });

  it('STORAGE_DRIVER=local on purpose -> warning, as before', async () => {
    spacesEnv();
    process.env.STORAGE_DRIVER = 'local';
    expect(await storageCheck()).toEqual({
      id: 'storage',
      label: 'Almacenamiento de evidencias',
      state: 'warning',
      detail: 'Disco local del servidor (no recomendado en producción)',
    });
  });

  it('local with LOCAL_UPLOAD_DIR on the project root -> error: uploads are not published', async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_UPLOAD_DIR = process.cwd();
    expect(await storageCheck()).toMatchObject({
      state: 'error',
      detail:
        'Disco local del servidor (no recomendado en producción). No se publican: LOCAL_UPLOAD_DIR es la carpeta del proyecto o la contiene',
    });
  });

  it('fallback plus a LOCAL_UPLOAD_DIR containing the project names both problems', async () => {
    process.env.STORAGE_DRIVER = 'spaces';
    process.env.LOCAL_UPLOAD_DIR = path.dirname(process.cwd());
    const check = await storageCheck();
    expect(check?.state).toBe('error');
    expect(check?.detail).toContain('Falta SPACES_BUCKET');
    expect(check?.detail).toContain('No se publican');
  });

  it('local with an evidence folder serveLocalUploads cannot mount -> error, not a plain warning', async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.SPACES_UPLOAD_PREFIX = '../fuera';
    expect(await storageCheck()).toEqual({
      id: 'storage',
      label: 'Almacenamiento de evidencias',
      state: 'error',
      detail:
        'Disco local del servidor (no recomendado en producción). No se publica ../fuera: SPACES_UPLOAD_PREFIX no es una ruta relativa simple',
    });
  });

  it('with the bucket in use an odd prefix is irrelevant: still ok', async () => {
    spacesEnv();
    process.env.SPACES_UPLOAD_PREFIX = 'evidencias prueba';
    expect(await storageCheck()).toMatchObject({ state: 'ok' });
  });

  it('the storage error drives the overall state and no secret is returned', async () => {
    spacesEnv();
    delete process.env.SPACES_SECRET_ACCESS_KEY;
    const result = await buildService().checks();
    expect(result.overall).toBe('error');
    expect(JSON.stringify(result)).not.toContain('"key"');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
