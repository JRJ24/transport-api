import { BadRequestException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import {
  getLocalUploadMount,
  isAllowedUploadMimeType,
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
    expect(resolveStorageTarget()).toEqual({ driver: 'local' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('spaces with bucket and credentials uses the bucket', () => {
    spacesEnv();
    expect(resolveStorageTarget()).toEqual({
      driver: 'spaces',
      bucket: 'ruta-evidences',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('spaces without bucket falls back to disk, warns once and does not throw', () => {
    process.env.STORAGE_DRIVER = 'spaces';
    expect(resolveStorageTarget()).toEqual({ driver: 'local' });
    expect(resolveStorageTarget()).toEqual({ driver: 'local' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('SPACES_BUCKET');
  });

  it('spaces with bucket but no credentials also falls back with a warning', () => {
    process.env.SPACES_BUCKET = 'ruta-evidences';
    expect(resolveStorageTarget()).toEqual({ driver: 'local' });
    expect(warnSpy.mock.calls[0][0]).toContain('SPACES_ACCESS_KEY_ID');
  });
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

  it('local: writes under the upload dir and builds the URL from the forwarded proto/host', async () => {
    process.env.STORAGE_DRIVER = 'local';
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
