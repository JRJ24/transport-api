import { BadRequestException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  AVATAR_UPLOAD_FOLDER,
  getConfiguredPublicApiOrigin,
  getEvidenceUploadFolder,
  getLocalUploadFolders,
  getLocalUploadMount,
  getUnservedUploadFolders,
  isAllowedUploadMimeType,
  isUnsafeLocalUploadRoot,
  processUploadedFiles,
  resolveStorageTarget,
  setLocalUploadHeaders,
  storeObject,
} from './processFile';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({
    input,
  })),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('sharp', () =>
  jest.fn().mockImplementation((input: Buffer) => {
    const chain = {
      resize: () => chain,
      webp: () => chain,
      toBuffer: () =>
        input.toString() === 'broken'
          ? Promise.reject(new Error('unsupported image format'))
          : Promise.resolve(Buffer.from('webp-bytes')),
    };
    return chain;
  }),
);

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
  'SPACES_ENDPOINT',
  'SPACES_REGION',
  'SPACES_PUBLIC_URL',
  'SPACES_UPLOAD_PREFIX',
  'LOCAL_UPLOAD_DIR',
  'LOCAL_UPLOAD_PUBLIC_URL',
  // Origen de las URLs locales (buildLocalPublicUrl).
  'PUBLIC_API_BASE_URL',
  'PAYMENT_CALLBACK_BASE_URL',
  'CORS_ORIGINS',
  'NODE_ENV',
  'PORT',
];

let savedEnv: Record<string, string | undefined>;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let dirCounter = 0;

beforeEach(() => {
  savedEnv = Object.fromEntries(STORAGE_ENV.map((k) => [k, process.env[k]]));
  for (const key of STORAGE_ENV) delete process.env[key];
  // Directorio distinto por test: el aviso es "una vez por mensaje".
  process.env.LOCAL_UPLOAD_DIR = path.join('/tmp', `uploads-${++dirCounter}`);
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  mockSend.mockReset().mockResolvedValue({});
  (mkdir as jest.Mock).mockClear();
  (writeFile as jest.Mock).mockClear();
});

afterEach(() => {
  for (const key of STORAGE_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

const spacesEnv = () => {
  process.env.STORAGE_DRIVER = 'spaces';
  process.env.SPACES_BUCKET = 'ruta-evidences';
  process.env.SPACES_ACCESS_KEY_ID = 'key';
  process.env.SPACES_SECRET_ACCESS_KEY = 'secret';
  process.env.SPACES_ENDPOINT = 'https://nyc3.digitaloceanspaces.com';
};

const fakeReq = (headers: Record<string, string>, protocol = 'http') =>
  ({
    protocol,
    host: headers['x-forwarded-host'] ?? headers.host,
    get: (name: string) => headers[name.toLowerCase()],
  }) as unknown as Request;

describe('resolveStorageTarget', () => {
  it('STORAGE_DRIVER=local goes to disk even with a bucket configured', () => {
    spacesEnv();
    process.env.STORAGE_DRIVER = 'local';
    expect(resolveStorageTarget()).toEqual({
      driver: 'local',
      reason: 'configured',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('spaces with bucket and credentials uses the bucket', () => {
    spacesEnv();
    expect(resolveStorageTarget()).toEqual({
      driver: 'spaces',
      bucket: 'ruta-evidences',
      region: 'nyc3',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports the region the S3 client really uses', () => {
    spacesEnv();
    process.env.SPACES_REGION = 'sfo3';
    expect(resolveStorageTarget()).toMatchObject({ region: 'sfo3' });
  });

  it('spaces without bucket falls back to disk, warns once and does not throw', () => {
    process.env.STORAGE_DRIVER = 'spaces';
    const fallback = {
      driver: 'local',
      reason: 'missing-config',
      requestedDriver: 'spaces',
      missing: [
        'SPACES_BUCKET',
        'SPACES_ACCESS_KEY_ID',
        'SPACES_SECRET_ACCESS_KEY',
      ],
    };
    expect(resolveStorageTarget()).toEqual(fallback);
    expect(resolveStorageTarget()).toEqual(fallback);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('SPACES_BUCKET');
  });

  it('spaces with bucket but no credentials also falls back, saying what is missing', () => {
    process.env.SPACES_BUCKET = 'ruta-evidences';
    expect(resolveStorageTarget()).toEqual({
      driver: 'local',
      reason: 'missing-config',
      requestedDriver: 'spaces',
      missing: ['SPACES_ACCESS_KEY_ID', 'SPACES_SECRET_ACCESS_KEY'],
    });
    expect(warnSpy.mock.calls[0][0]).toContain('SPACES_ACCESS_KEY_ID');
  });
});

describe('upload folders', () => {
  it('evidences and avatars by default: what storeObject writes', () => {
    expect(getEvidenceUploadFolder()).toBe('evidences');
    expect(getLocalUploadFolders()).toEqual([
      'evidences',
      AVATAR_UPLOAD_FOLDER,
    ]);
  });

  it('SPACES_UPLOAD_PREFIX without surrounding slashes, so keys and mount agree', () => {
    process.env.SPACES_UPLOAD_PREFIX = '/docs/evidencias/';
    expect(getEvidenceUploadFolder()).toBe('docs/evidencias');
    expect(getLocalUploadFolders()).toEqual(['docs/evidencias', 'avatars']);
  });

  it('a prefix of only slashes keeps the default', () => {
    process.env.SPACES_UPLOAD_PREFIX = '/';
    expect(getEvidenceUploadFolder()).toBe('evidences');
  });

  it('does not repeat a folder when the prefix is avatars', () => {
    process.env.SPACES_UPLOAD_PREFIX = 'avatars';
    expect(getLocalUploadFolders()).toEqual(['avatars']);
  });

  it('every default folder is servable', () => {
    expect(getUnservedUploadFolders()).toEqual([]);
    process.env.SPACES_UPLOAD_PREFIX = 'docs/evidencias.v2';
    expect(getUnservedUploadFolders()).toEqual([]);
  });

  it.each([
    ['../outside'],
    ['docs//evidencias'],
    ['evidencias prueba'],
    ['evidences:id'],
  ])(
    'SPACES_UPLOAD_PREFIX=%s is reported as unserved (avatars still served)',
    (prefix) => {
      process.env.SPACES_UPLOAD_PREFIX = prefix;
      expect(getUnservedUploadFolders()).toEqual([prefix]);
    },
  );
});

describe('isUnsafeLocalUploadRoot', () => {
  it('the working directory itself is unsafe', () => {
    expect(isUnsafeLocalUploadRoot(process.cwd())).toBe(true);
  });

  it('a folder that contains the working directory is unsafe', () => {
    expect(isUnsafeLocalUploadRoot(path.dirname(process.cwd()))).toBe(true);
    expect(isUnsafeLocalUploadRoot(path.parse(process.cwd()).root)).toBe(true);
  });

  it('a subfolder of the project (the default dist/common/public) is fine', () => {
    expect(
      isUnsafeLocalUploadRoot(path.join(process.cwd(), 'dist', 'public')),
    ).toBe(false);
  });

  it('a folder elsewhere is fine, also a sibling whose name starts like the project', () => {
    expect(isUnsafeLocalUploadRoot(path.join(os.tmpdir(), 'uploads'))).toBe(
      false,
    );
    expect(isUnsafeLocalUploadRoot(`${process.cwd()}-uploads`)).toBe(false);
  });

  it('defaults to LOCAL_UPLOAD_DIR', () => {
    process.env.LOCAL_UPLOAD_DIR = process.cwd();
    expect(isUnsafeLocalUploadRoot()).toBe(true);
  });

  (process.platform === 'win32' ? it : it.skip)(
    'on Windows the comparison ignores case',
    () => {
      expect(isUnsafeLocalUploadRoot(process.cwd().toUpperCase())).toBe(true);
    },
  );
});

describe('storeObject', () => {
  it('uploads to Spaces with public-read and returns the bucket URL', async () => {
    spacesEnv();
    const url = await storeObject({
      key: 'evidences/a.webp',
      body: Buffer.from('x'),
      contentType: 'image/webp',
      req: fakeReq({ host: 'api.test' }),
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toMatchObject({
      Bucket: 'ruta-evidences',
      Key: 'evidences/a.webp',
      ACL: 'public-read',
    });
    expect(url).toBe(
      'https://ruta-evidences.nyc3.digitaloceanspaces.com/evidences/a.webp',
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('local: writes under the upload dir and builds the URL from the configured public origin', async () => {
    process.env.STORAGE_DRIVER = 'local';
    // Lo que define docker-compose en produccion.
    process.env.PAYMENT_CALLBACK_BASE_URL = 'https://api.larutard.com.do/api/v1';
    const url = await storeObject({
      key: 'evidences/a.webp',
      body: Buffer.from('x'),
      contentType: 'image/webp',
      // Lo que llega detras de nginx con trust proxy: req.protocol y req.host
      // ya vienen de X-Forwarded-*.
      req: fakeReq(
        { host: 'localhost:3000', 'x-forwarded-host': 'api.larutard.com.do' },
        'https',
      ),
    });
    expect(mockSend).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(
      path.join(getLocalUploadMount().root, 'evidences', 'a.webp'),
      expect.any(Buffer),
    );
    // Solo el origen: el static se monta en la raiz, no bajo /api/v1.
    expect(url).toBe('https://api.larutard.com.do/evidences/a.webp');
  });

  it('local with LOCAL_UPLOAD_PUBLIC_URL uses that base', async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.LOCAL_UPLOAD_PUBLIC_URL = 'http://192.168.1.10:3000/uploads/';
    const url = await storeObject({
      key: 'avatars/u.webp',
      body: Buffer.from('x'),
      contentType: 'image/webp',
      req: fakeReq({ host: 'ignored' }),
    });
    expect(url).toBe('http://192.168.1.10:3000/uploads/avatars/u.webp');
    // avatars/ es una carpeta servida: sin aviso.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('local: a key outside the served folders is written but warns that its URL will 404', async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.PUBLIC_API_BASE_URL = 'http://api.test';
    await storeObject({
      key: 'documents/a.pdf',
      body: Buffer.from('x'),
      contentType: 'application/pdf',
      req: fakeReq({ host: 'api.test' }),
    });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('"documents"');
    expect(warnSpy.mock.calls[0][0]).toContain('evidences, avatars');
  });
});

/**
 * Con trust proxy 1, req.host y req.protocol salen de X-Forwarded-Host/Proto,
 * y nginx (sin default_server) deja pasar un Host ajeno: ese valor nunca puede
 * terminar en el fileUrl guardado.
 */
describe('local upload URL origin (forged Host / X-Forwarded-Host)', () => {
  const FORGED = { host: 'api:3000', 'x-forwarded-host': 'evil.example' };

  const storeLocal = (
    req: Request,
    key = `evidences/${randomName()}.webp`,
  ): Promise<string> =>
    storeObject({
      key,
      body: Buffer.from('x'),
      contentType: 'image/webp',
      req,
    });

  let nameCounter = 0;
  const randomName = () => `file-${++nameCounter}`;

  beforeEach(() => {
    process.env.STORAGE_DRIVER = 'local';
  });

  it('PUBLIC_API_BASE_URL wins over the forged header (origin only, also over PAYMENT_CALLBACK_BASE_URL)', async () => {
    process.env.PUBLIC_API_BASE_URL = 'https://api.larutard.com.do/api/v1/';
    process.env.PAYMENT_CALLBACK_BASE_URL = 'https://pagos.example.com/api/v1';
    const url = await storeLocal(fakeReq(FORGED, 'https'), 'evidences/a.webp');
    expect(url).toBe('https://api.larutard.com.do/evidences/a.webp');
    expect(url).not.toContain('evil.example');
  });

  it('without PUBLIC_API_BASE_URL it uses the origin of PAYMENT_CALLBACK_BASE_URL (what production has)', async () => {
    process.env.PAYMENT_CALLBACK_BASE_URL = 'https://api.larutard.com.do/api/v1';
    const url = await storeLocal(fakeReq(FORGED, 'http'), 'evidences/b.webp');
    // Tambien el protocolo sale de la config, no de X-Forwarded-Proto.
    expect(url).toBe('https://api.larutard.com.do/evidences/b.webp');
  });

  it('LOCAL_UPLOAD_PUBLIC_URL still has the last word', async () => {
    process.env.LOCAL_UPLOAD_PUBLIC_URL = 'http://192.168.1.10:3000/uploads';
    process.env.PUBLIC_API_BASE_URL = 'https://api.larutard.com.do';
    const url = await storeLocal(fakeReq(FORGED), 'evidences/c.webp');
    expect(url).toBe('http://192.168.1.10:3000/uploads/evidences/c.webp');
  });

  it.each([['api.larutard.com.do'], ['javascript:alert(1)'], ['  ']])(
    'an unusable PUBLIC_API_BASE_URL (%s) is ignored, never echoed',
    (value) => {
      process.env.PUBLIC_API_BASE_URL = value;
      process.env.PAYMENT_CALLBACK_BASE_URL = 'https://api.larutard.com.do/x';
      expect(getConfiguredPublicApiOrigin()).toBe('https://api.larutard.com.do');
      delete process.env.PAYMENT_CALLBACK_BASE_URL;
      expect(getConfiguredPublicApiOrigin()).toBeNull();
    },
  );

  it('nothing configured: a host of CORS_ORIGINS is accepted, with the configured protocol', async () => {
    process.env.CORS_ORIGINS =
      'https://portal.larutard.com.do, https://api.larutard.com.do';
    const url = await storeLocal(
      fakeReq(
        { host: 'api:3000', 'x-forwarded-host': 'api.larutard.com.do' },
        'http',
      ),
      'evidences/d.webp',
    );
    expect(url).toBe('https://api.larutard.com.do/evidences/d.webp');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('nothing configured: a forged host is replaced by the first allowed origin and warns once, without the host', async () => {
    // Origen unico en este test: warnOnce recuerda los mensajes ya emitidos.
    process.env.CORS_ORIGINS = 'https://first-allowed.example,https://x.test';
    process.env.NODE_ENV = 'production';
    const first = await storeLocal(fakeReq(FORGED, 'https'), 'evidences/e.webp');
    const second = await storeLocal(
      fakeReq({ host: 'other-evil.example' }, 'https'),
    );

    expect(first).toBe('https://first-allowed.example/evidences/e.webp');
    expect(second).toMatch(/^https:\/\/first-allowed\.example\/evidences\//);
    // Un solo aviso para hosts distintos: el mensaje no lleva el host
    // recibido (si no, cada Host falso sumaria una entrada al Set).
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain('PUBLIC_API_BASE_URL');
    expect(message).not.toContain('evil');
  });

  it('nothing configured and no CORS_ORIGINS: falls back to localhost on PORT, never the header', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3999';
    const url = await storeLocal(fakeReq(FORGED, 'https'), 'evidences/f.webp');
    expect(url).toBe('http://localhost:3999/evidences/f.webp');
  });

  it.each([
    ['localhost:3000', 'http', 'http://localhost:3000'],
    ['127.0.0.1:3000', 'https', 'https://127.0.0.1:3000'],
    ['192.168.1.10:3000', 'http', 'http://192.168.1.10:3000'],
    ['10.0.2.2:3000', 'http', 'http://10.0.2.2:3000'],
    ['172.20.0.5:3000', 'http', 'http://172.20.0.5:3000'],
    // X-Forwarded-Proto raro: no se copia.
    ['localhost:3000', 'javascript', 'http://localhost:3000'],
  ])(
    'outside production %s (proto %s) is accepted as %s (dev and LAN phones)',
    async (host, protocol, origin) => {
      const url = await storeLocal(fakeReq({ host }, protocol), 'avatars/u.webp');
      expect(url).toBe(`${origin}/avatars/u.webp`);
    },
  );

  it.each([
    ['localhost:3000'],
    ['192.168.1.10:3000'],
  ])('in production %s is not accepted', async (host) => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://api.larutard.com.do';
    const url = await storeLocal(fakeReq({ host }), 'evidences/g.webp');
    expect(url).toBe('https://api.larutard.com.do/evidences/g.webp');
  });

  it.each([
    ['evil.example@localhost:3000'],
    ['localhost:3000/../evil.example'],
    ['127.0.0.1.evil.example'],
    ['192.168.1.10.evil.example'],
  ])(
    'tricky host %s never smuggles the foreign host into the URL',
    async (host) => {
      process.env.CORS_ORIGINS = 'https://api.larutard.com.do';
      const url = await storeLocal(fakeReq({ host }), 'evidences/h.webp');
      expect(url).not.toContain('evil');
      expect(new URL(url).pathname).toBe('/evidences/h.webp');
    },
  );

  it('avatars (account.service) follow the same rule', async () => {
    process.env.PAYMENT_CALLBACK_BASE_URL = 'https://api.larutard.com.do/api/v1';
    const url = await storeLocal(fakeReq(FORGED, 'https'), 'avatars/u-1.webp');
    expect(url).toBe('https://api.larutard.com.do/avatars/u-1.webp');
  });
});

describe('getLocalUploadMount', () => {
  it('serves the upload dir at the host root when no public URL is set', () => {
    expect(getLocalUploadMount()).toEqual({
      root: path.resolve(process.env.LOCAL_UPLOAD_DIR as string),
      prefix: '/',
    });
  });

  it('uses the path of LOCAL_UPLOAD_PUBLIC_URL so the generated URLs resolve', () => {
    process.env.LOCAL_UPLOAD_PUBLIC_URL = 'http://localhost:3000/uploads/';
    expect(getLocalUploadMount().prefix).toBe('/uploads');
  });
});

describe('setLocalUploadHeaders', () => {
  const fakeRes = () => {
    const headers: Record<string, string> = {};
    return {
      headers,
      res: {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      } as unknown as Response,
    };
  };

  it('lets other origins embed the images and pins the content type', () => {
    const { headers, res } = fakeRes();
    setLocalUploadHeaders(res, '/x/evidences/a.webp');
    expect(headers).toEqual({
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': 'image/webp',
    });
  });

  it('forces download for extensions this module never writes', () => {
    const { headers, res } = fakeRes();
    setLocalUploadHeaders(res, '/x/evidences/old.html');
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['Content-Disposition']).toBe('attachment');
  });
});

describe('processUploadedFiles', () => {
  const file = (
    originalname: string,
    mimetype: string,
    content = 'data',
  ): Express.Multer.File =>
    ({
      fieldname: 'files',
      originalname,
      mimetype,
      buffer: Buffer.from(content),
      size: content.length,
    }) as Express.Multer.File;

  beforeEach(() => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.PUBLIC_API_BASE_URL = 'http://api.test';
  });

  it('converts images to webp and keeps the UploadedFile shape', async () => {
    const [stored] = await processUploadedFiles(
      [file('Firma signature.PNG', 'image/png')],
      fakeReq({ host: 'api.test' }),
    );
    expect(stored).toMatchObject({
      fieldName: 'files',
      originalName: 'Firma signature.PNG',
      mimeType: 'image/webp',
      size: Buffer.from('webp-bytes').byteLength,
    });
    expect(stored.fileName).toMatch(/^[0-9a-f-]{36}-firma-signature\.webp$/);
    expect(stored.key).toBe(`evidences/${stored.fileName}`);
    expect(stored.url).toBe(`http://api.test/evidences/${stored.fileName}`);
  });

  it.each([
    ['signature-1.png', 'image/png'], // app-drivers
    ['signature-1.svg', 'image/svg+xml'], // transport-driver
  ])(
    'a signature %s (%s) is stored as image/webp, which addSignature requires',
    async (name, mime) => {
      const [stored] = await processUploadedFiles(
        [file(name, mime)],
        fakeReq({ host: 'api.test' }),
      );
      expect(stored.mimeType).toBe('image/webp');
      expect(stored.fileName).toMatch(/-signature-1\.webp$/);
    },
  );

  it('the evidence url (the stored fileUrl) ignores a forged X-Forwarded-Host', async () => {
    const [stored] = await processUploadedFiles(
      [file('photo.jpg', 'image/jpeg')],
      fakeReq(
        { host: 'api:3000', 'x-forwarded-host': 'evil.example' },
        'https',
      ),
    );
    expect(stored.url).toBe(`http://api.test/evidences/${stored.fileName}`);
  });

  it('uses SPACES_UPLOAD_PREFIX without surrounding slashes as the key folder', async () => {
    process.env.SPACES_UPLOAD_PREFIX = '/docs/evidencias/';
    const [stored] = await processUploadedFiles(
      [file('a.pdf', 'application/pdf')],
      fakeReq({ host: 'api.test' }),
    );
    expect(stored.key).toBe(`docs/evidencias/${stored.fileName}`);
    expect(stored.url).toBe(
      `http://api.test/docs/evidencias/${stored.fileName}`,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the extension follows the declared mime type, not the client name', async () => {
    const [stored] = await processUploadedFiles(
      [file('evil.html', 'text/plain')],
      fakeReq({ host: 'api.test' }),
    );
    expect(stored.fileName).toMatch(/-evil\.txt$/);
    expect(stored.mimeType).toBe('text/plain');
  });

  it('a corrupt image is a 400, not a 500, and nothing is written', async () => {
    await expect(
      processUploadedFiles(
        [file('photo.jpg', 'image/jpeg', 'broken')],
        fakeReq({ host: 'api.test' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects types outside the allowlist', async () => {
    await expect(
      processUploadedFiles(
        [file('x.html', 'text/html')],
        fakeReq({ host: 'api.test' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('isAllowedUploadMimeType', () => {
  it.each([
    ['image/jpeg', true],
    ['application/pdf', true],
    ['video/mp4', true],
    ['text/html', false],
    ['application/javascript', false],
    ['constructor', false],
  ])('%s -> %s', (mime, expected) => {
    expect(isAllowedUploadMimeType(mime)).toBe(expected);
  });
});
