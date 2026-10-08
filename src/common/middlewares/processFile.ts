import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, HttpStatus, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { ERROR_CODES } from '../constants/error-codes.constant';
import { ApplicationException } from '../exceptions/application.exception';

export interface UploadedFile {
  fieldName?: string;
  key: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

const logger = new Logger('Storage');

/**
 * Tipos no imagen que se aceptan como evidencia y la extension con la que se
 * guardan. La extension sale del tipo y no del nombre que manda el cliente:
 * en disco el Content-Type lo decide la extension, y un 'x.html' declarado
 * como text/plain se serviria como HTML desde el origen del API.
 */
const EXTENSION_BY_MIME_TYPE = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['application/msword', 'doc'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'docx',
  ],
  ['application/vnd.ms-excel', 'xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['text/csv', 'csv'],
  ['text/plain', 'txt'],
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
]);

/** Content-Type con el que se sirve cada extension que este modulo escribe. */
const MIME_TYPE_BY_EXTENSION = new Map<string, string>([
  ['webp', 'image/webp'],
  ...[...EXTENSION_BY_MIME_TYPE].map(
    ([mimeType, extension]) => [extension, mimeType] as [string, string],
  ),
]);

/** Imagenes (se convierten a webp) y los documentos/videos de arriba. */
export function isAllowedUploadMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/') || EXTENSION_BY_MIME_TYPE.has(mimeType);
}

const sanitizeFileName = (fileName: string) => {
  const safeName = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return safeName || 'file';
};

const getBucketName = () =>
  process.env.SPACES_NAME ||
  process.env.SPACES_BUCKET ||
  process.env.S3_BUCKET ||
  process.env.ACCESS_KEY_NAME;

const getSpacesCredentials = () => ({
  accessKeyId:
    process.env.SPACES_ACCESS_KEY_ID || process.env.ACCESS_KEY_ID || '',
  secretAccessKey:
    process.env.SPACES_SECRET_ACCESS_KEY || process.env.ACCESS_SECRET_KEY || '',
});

let s3: { signature: string; client: S3Client } | null = null;

/**
 * El cliente se crea al primer uso y no al importar: este archivo se importa
 * antes de que ConfigModule cargue el .env, y entonces el cliente quedaba
 * sin endpoint ni claves aunque el .env las tuviera.
 */
function getS3Client(): S3Client {
  const credentials = getSpacesCredentials();
  const endpoint = process.env.SPACES_ENDPOINT || undefined;
  const region = process.env.SPACES_REGION || 'nyc3';
  const signature = [
    endpoint,
    region,
    credentials.accessKeyId,
    credentials.secretAccessKey,
  ].join('|');

  if (!s3 || s3.signature !== signature) {
    s3 = {
      signature,
      client: new S3Client({ endpoint, region, credentials }),
    };
  }
  return s3.client;
}

const buildPublicUrl = (bucketName: string, key: string) => {
  const publicBase = process.env.SPACES_PUBLIC_URL?.replace(/\/+$/, '');
  if (publicBase) return `${publicBase}/${key}`;

  const endpoint = process.env.SPACES_ENDPOINT;
  if (endpoint) {
    const endpointUrl = new URL(
      endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
    );
    const host = endpointUrl.host.startsWith(`${bucketName}.`)
      ? endpointUrl.host
      : `${bucketName}.${endpointUrl.host}`;
    return `${endpointUrl.protocol}//${host}/${key}`;
  }

  const region = process.env.SPACES_REGION || 'nyc3';
  return `https://${bucketName}.${region}.digitaloceanspaces.com/${key}`;
};

const getLocalPublicRoot = () =>
  path.resolve(
    process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, '..', 'public'),
  );

const buildLocalPublicUrl = (req: Request, key: string) => {
  const publicBase = process.env.LOCAL_UPLOAD_PUBLIC_URL?.replace(/\/+$/, '');
  if (publicBase) return `${publicBase}/${key}`;

  // Con trust proxy, req.protocol y req.host salen de X-Forwarded-Proto y
  // X-Forwarded-Host: detras de nginx la URL usa el dominio publico y https,
  // no el host interno al que nginx reenvia.
  const host = req.host || req.get('host');
  return `${req.protocol}://${host}/${key}`;
};

export type StorageTarget =
  { driver: 'spaces'; bucket: string } | { driver: 'local' };

const warnedMessages = new Set<string>();

const warnOnce = (message: string) => {
  if (warnedMessages.has(message)) return;
  warnedMessages.add(message);
  logger.warn(message);
};

/**
 * Donde se guardan los archivos segun STORAGE_DRIVER. 'local' va a disco.
 * 'spaces'/'s3' van al bucket; si falta el bucket o las claves se avisa una
 * vez y se cae a disco, como hacia antes en silencio. No se lanza error: asi
 * arranca hoy produccion y es mejor guardar la evidencia en disco (que este
 * API sirve) que rechazar la entrega del conductor.
 */
export function resolveStorageTarget(): StorageTarget {
  const driver = (process.env.STORAGE_DRIVER || 'spaces').trim().toLowerCase();
  if (driver === 'local') {
    return { driver: 'local' };
  }

  const bucket = getBucketName();
  const credentials = getSpacesCredentials();
  const missing = [
    !bucket && 'SPACES_BUCKET',
    !credentials.accessKeyId && 'SPACES_ACCESS_KEY_ID',
    !credentials.secretAccessKey && 'SPACES_SECRET_ACCESS_KEY',
  ].filter((name): name is string => Boolean(name));

  if (bucket && missing.length === 0) {
    return { driver: 'spaces', bucket };
  }

  warnOnce(
    `STORAGE_DRIVER=${driver} but ${missing.join(', ')} is not set: uploads are written to local disk (${getLocalPublicRoot()}) and served by this API. Configure the bucket for durable storage.`,
  );
  return { driver: 'local' };
}

/**
 * Stores one object in Spaces (or on local disk, see resolveStorageTarget)
 * and returns its public URL. Shared by the evidence upload below and by
 * avatars.
 */
export async function storeObject(input: {
  key: string;
  body: Buffer;
  contentType: string;
  req: Request;
}): Promise<string> {
  const target = resolveStorageTarget();
  if (target.driver === 'spaces') {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: target.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ACL: 'public-read',
      }),
    );
    return buildPublicUrl(target.bucket, input.key);
  }

  const localPath = path.join(getLocalPublicRoot(), ...input.key.split('/'));
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, input.body);
  return buildLocalPublicUrl(input.req, input.key);
}

/**
 * Carpeta local y ruta URL desde la que main.ts la sirve. Es la misma ruta que
 * arma buildLocalPublicUrl: la raiz del host, o el path de
 * LOCAL_UPLOAD_PUBLIC_URL si esta definida.
 */
export function getLocalUploadMount(): { root: string; prefix: string } {
  const publicBase = process.env.LOCAL_UPLOAD_PUBLIC_URL?.trim();
  let pathname = '/';
  if (publicBase) {
    try {
      pathname = new URL(publicBase).pathname;
    } catch {
      pathname = publicBase.startsWith('/') ? publicBase : '/';
    }
  }

  return {
    root: getLocalPublicRoot(),
    prefix: pathname.replace(/\/+$/, '') || '/',
  };
}

/**
 * setHeaders del static de uploads. Solo afecta a esa ruta: el resto del API
 * conserva los headers de helmet.
 */
export function setLocalUploadHeaders(res: Response, filePath: string): void {
  // helmet pone Cross-Origin-Resource-Policy: same-origin, que impide al
  // portal y a la web de clientes (otro origen) mostrar fotos y firmas.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const extension = path.extname(filePath).slice(1).toLowerCase();
  const mimeType = MIME_TYPE_BY_EXTENSION.get(extension);
  if (mimeType) {
    res.setHeader('Content-Type', mimeType);
    return;
  }
  // Archivos viejos con otra extension: se descargan, nunca se interpretan
  // (un .html o .svg ejecutaria script en el origen del API).
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment');
}

/**
 * Monta el static de uploads locales (lo llama main.ts). Aqui y no en main.ts
 * para poder probar con helmet delante que las URLs que arma
 * buildLocalPublicUrl responden y que solo esta ruta relaja CORP. Llamar
 * despues de helmet(), para que setLocalUploadHeaders pise su header.
 */
export function serveLocalUploads(
  app: Pick<NestExpressApplication, 'useStaticAssets'>,
): void {
  const { root, prefix } = getLocalUploadMount();
  app.useStaticAssets(root, {
    prefix,
    index: false,
    redirect: false,
    fallthrough: true,
    // Las claves son unicas (uuid o timestamp) y no se sobrescriben.
    maxAge: '7d',
    immutable: true,
    setHeaders: setLocalUploadHeaders,
  });
}

const toWebp = async (buffer: Buffer): Promise<Buffer> => {
  try {
    return await sharp(buffer)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    // Un archivo que dice ser imagen y no lo es es un error del cliente, no un 500.
    throw new BadRequestException({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'La imagen no se pudo procesar.',
    });
  }
};

/**
 * Convierte (imagenes a webp) y guarda los archivos que Multer dejo en memoria.
 * Se llama solo despues de autorizar: antes esto corria como middleware, antes
 * de los guards, y una peticion sin token ya dejaba los archivos publicados.
 */
export async function processUploadedFiles(
  files: Express.Multer.File[],
  req: Request,
): Promise<UploadedFile[]> {
  const uploadPrefix = process.env.SPACES_UPLOAD_PREFIX || 'evidences';

  return Promise.all(
    files.map(async (file): Promise<UploadedFile> => {
      const baseName = `${randomUUID()}-${sanitizeFileName(file.originalname)}`;
      const withoutExtension = baseName.replace(/\.[^.]+$/, '');
      let fileName: string;
      let contentType: string;
      let fileBuffer: Buffer;

      if (file.mimetype.startsWith('image/')) {
        fileName = `${withoutExtension}.webp`;
        contentType = 'image/webp';
        fileBuffer = await toWebp(file.buffer);
      } else {
        const extension = EXTENSION_BY_MIME_TYPE.get(file.mimetype);
        // El fileFilter de Multer ya los rechaza; esto cubre otro llamador.
        if (!extension) {
          throw new BadRequestException({
            code: ERROR_CODES.BAD_REQUEST,
            message: 'Formato no soportado para evidencias.',
          });
        }
        fileName = `${withoutExtension}.${extension}`;
        contentType = file.mimetype;
        fileBuffer = file.buffer;
      }

      const fileKey = `${uploadPrefix}/${fileName}`;
      let url: string;
      try {
        url = await storeObject({
          key: fileKey,
          body: fileBuffer,
          contentType,
          req,
        });
      } catch (error) {
        logger.error(
          `Upload of ${fileKey} failed: ${error instanceof Error ? error.message : 'unknown'}`,
          error instanceof Error ? error.stack : undefined,
        );
        throw new ApplicationException(
          ERROR_CODES.INTERNAL_ERROR,
          'Error procesando archivos',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return {
        fieldName: file.fieldname,
        key: fileKey,
        fileName,
        originalName: file.originalname,
        mimeType: contentType,
        size: fileBuffer.byteLength,
        url,
      };
    }),
  );
}
