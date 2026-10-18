import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BadRequestException, HttpStatus, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { realpathSync } from 'fs';
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

const getSpacesRegion = () => process.env.SPACES_REGION || 'nyc3';

let s3: { signature: string; client: S3Client } | null = null;

/**
 * El cliente se crea al primer uso y no al importar: este archivo se importa
 * antes de que ConfigModule cargue el .env, y entonces el cliente quedaba
 * sin endpoint ni claves aunque el .env las tuviera.
 */
function getS3Client(): S3Client {
  const credentials = getSpacesCredentials();
  const endpoint = process.env.SPACES_ENDPOINT || undefined;
  const region = getSpacesRegion();
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

  return `https://${bucketName}.${getSpacesRegion()}.digitaloceanspaces.com/${key}`;
};

const getLocalPublicRoot = () =>
  path.resolve(
    process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, '..', 'public'),
  );

/** Carpeta de avatares. La clave la arma account.service.ts (uploadAvatar). */
export const AVATAR_UPLOAD_FOLDER = 'avatars';

/**
 * Carpeta de evidencias (SPACES_UPLOAD_PREFIX), sin barras al inicio ni al
 * final: con '/evidences/' la clave quedaba '/evidences//x' y su URL no
 * coincidia con la ruta que monta serveLocalUploads.
 */
export function getEvidenceUploadFolder(): string {
  const folder = (process.env.SPACES_UPLOAD_PREFIX || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  return folder || 'evidences';
}

/**
 * Carpetas (primer tramo de la clave) que escribe storeObject. serveLocalUploads
 * publica solo estas y no todo LOCAL_UPLOAD_DIR, para que una carpeta mal
 * configurada no exponga lo que haya al lado (package.json, dist, .env). Un
 * llamador nuevo de storeObject con otra carpeta tiene que agregarse aqui.
 */
export function getLocalUploadFolders(): string[] {
  return [...new Set([getEvidenceUploadFolder(), AVATAR_UPLOAD_FOLDER])];
}

const isPlainFolderSegment = (segment: string) =>
  /^[a-zA-Z0-9._-]+$/.test(segment) && segment !== '.' && segment !== '..';

/** Un '..' saldria de la raiz y un ':' o '(' romperia la ruta de Express. */
const isServableUploadFolder = (folder: string) =>
  folder.split('/').every(isPlainFolderSegment);

/**
 * Carpetas de getLocalUploadFolders() que serveLocalUploads no monta: sus
 * archivos se guardan igual pero dan 404. Se exporta para que el estado del
 * sistema lo muestre como error, igual que un LOCAL_UPLOAD_DIR inseguro, y no
 * como un simple aviso de disco local.
 */
export function getUnservedUploadFolders(): string[] {
  return getLocalUploadFolders().filter(
    (folder) => !isServableUploadFolder(folder),
  );
}

const realPathOrSelf = (target: string) => {
  try {
    return realpathSync.native(target);
  } catch {
    // Todavia no existe (se crea con el primer upload): se compara tal cual.
    return target;
  }
};

/**
 * true si la carpeta de uploads es el directorio de trabajo del proceso o uno
 * que lo contiene (LOCAL_UPLOAD_DIR=. o la raiz del disco): ahi el codigo, dist
 * y el .env quedarian junto a los uploads. Se resuelven symlinks para que un
 * enlace al proyecto no pase el control; path.relative ya compara sin
 * mayusculas en Windows.
 */
export function isUnsafeLocalUploadRoot(
  root: string = getLocalPublicRoot(),
): boolean {
  const relative = path.relative(
    realPathOrSelf(path.resolve(root)),
    realPathOrSelf(process.cwd()),
  );
  if (relative === '') return true;
  const cwdIsOutside =
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  return !cwdIsOutside;
}

/**
 * Destino real de storeObject. 'local' dice por que: elegido con
 * STORAGE_DRIVER=local, o caida a disco porque al bucket le falta
 * configuracion (lo que el estado del sistema tiene que mostrar como fallo).
 */
export type StorageTarget =
  | { driver: 'spaces'; bucket: string; region: string }
  | { driver: 'local'; reason: 'configured' }
  | {
      driver: 'local';
      reason: 'missing-config';
      requestedDriver: string;
      missing: string[];
    };

const warnedMessages = new Set<string>();

const warnOnce = (message: string) => {
  if (warnedMessages.has(message)) return;
  warnedMessages.add(message);
  logger.warn(message);
};

/** URL http(s) valida o null (vacia, sin esquema, javascript:, etc.). */
const parseHttpUrl = (value: string | undefined): URL | null => {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

/**
 * Origen publico configurado de este API: PUBLIC_API_BASE_URL o, si falta, el
 * de PAYMENT_CALLBACK_BASE_URL, que ya es la base publica del API (CardNET y
 * AZUL llaman ahi; docker-compose la define siempre, por defecto
 * https://api.larutard.com.do/api/v1). Solo el origen: el static de uploads se
 * monta en la raiz del host (getLocalUploadMount); para servirlos bajo otra
 * ruta esta LOCAL_UPLOAD_PUBLIC_URL.
 */
export function getConfiguredPublicApiOrigin(): string | null {
  return (
    parseHttpUrl(process.env.PUBLIC_API_BASE_URL)?.origin ??
    parseHttpUrl(process.env.PAYMENT_CALLBACK_BASE_URL)?.origin ??
    null
  );
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const PRIVATE_IPV4 =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

/** El propio equipo o una IP de la LAN (un movil probando contra el PC). */
const isDevHostname = (hostname: string) =>
  LOOPBACK_HOSTNAMES.has(hostname) || PRIVATE_IPV4.test(hostname);

/**
 * Origen de las URLs locales cuando no hay nada configurado. El Host de la
 * peticion no es de fiar: con trust proxy, req.host sale de X-Forwarded-Host,
 * y nginx no tiene default_server, asi que una peticion con un Host ajeno
 * llega al API con X-Forwarded-Host = ese host. Un conductor subia una foto
 * real y el fileUrl guardado quedaba en https://evil.example/evidences/...,
 * que ademas pasaba el control de firma propia (la URL es la del adjunto).
 *
 * Por eso el host solo se acepta si es el de uno de nuestros origenes
 * (CORS_ORIGINS) o, fuera de produccion, localhost/LAN; si no, se usa el
 * primer origen permitido. Lo que sale es siempre el origen normalizado por
 * URL, nunca el header tal cual (un 'a@b' o 'host/x' no cuela nada).
 */
const resolveRequestOrigin = (req: Request): string => {
  const allowed = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => parseHttpUrl(origin))
    .filter((url): url is URL => url !== null);
  const isProduction = process.env.NODE_ENV === 'production';
  const requested = parseHttpUrl(`http://${req.host || req.get('host') || ''}`);

  if (requested) {
    const match = allowed.find((origin) => origin.host === requested.host);
    // El protocolo tambien sale de la config, no de X-Forwarded-Proto.
    if (match) return match.origin;
    if (!isProduction && isDevHostname(requested.hostname)) {
      const protocol = req.protocol === 'https' ? 'https' : 'http';
      return `${protocol}://${requested.host}`;
    }
  }

  const fallback =
    allowed[0]?.origin ?? `http://localhost:${process.env.PORT || 3000}`;
  // Mensaje fijo, sin el host recibido: warnOnce guarda cada mensaje y un host
  // por peticion haria crecer ese Set sin limite.
  warnOnce(
    `Local upload URL: the request host is not an allowed origin, so ${fallback} is used instead. Set PUBLIC_API_BASE_URL (or LOCAL_UPLOAD_PUBLIC_URL) to the public URL of this API.`,
  );
  return fallback;
};

/**
 * URL publica de un archivo en disco local. Orden: LOCAL_UPLOAD_PUBLIC_URL
 * (base completa, tambien fija la ruta del static), el origen configurado del
 * API y, solo si no hay ninguno, el host de la peticion si esta permitido.
 */
const buildLocalPublicUrl = (req: Request, key: string) => {
  const publicBase = process.env.LOCAL_UPLOAD_PUBLIC_URL?.replace(/\/+$/, '');
  if (publicBase) return `${publicBase}/${key}`;

  const origin = getConfiguredPublicApiOrigin() ?? resolveRequestOrigin(req);
  return `${origin}/${key}`;
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
    return { driver: 'local', reason: 'configured' };
  }

  const bucket = getBucketName();
  const credentials = getSpacesCredentials();
  const missing = [
    !bucket && 'SPACES_BUCKET',
    !credentials.accessKeyId && 'SPACES_ACCESS_KEY_ID',
    !credentials.secretAccessKey && 'SPACES_SECRET_ACCESS_KEY',
  ].filter((name): name is string => Boolean(name));

  if (bucket && missing.length === 0) {
    return { driver: 'spaces', bucket, region: getSpacesRegion() };
  }

  warnOnce(
    `STORAGE_DRIVER=${driver} but ${missing.join(', ')} is not set: uploads are written to local disk (${getLocalPublicRoot()}) and served by this API. Configure the bucket for durable storage.`,
  );
  return {
    driver: 'local',
    reason: 'missing-config',
    requestedDriver: driver,
    missing,
  };
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

  const folders = getLocalUploadFolders();
  if (!folders.some((folder) => input.key.startsWith(`${folder}/`))) {
    // Se guarda igual, pero serveLocalUploads no publica esa carpeta y la URL
    // daria 404: aviso para quien agregue un llamador sin sumar su carpeta.
    warnOnce(
      `Upload folder "${path.posix.dirname(input.key)}" is not served by serveLocalUploads (${folders.join(', ')}): its local URLs return 404. Add it to getLocalUploadFolders().`,
    );
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
 *
 * Un static por carpeta de getLocalUploadFolders(), con su propio prefijo y
 * raiz, y no uno sobre todo LOCAL_UPLOAD_DIR: si esa variable apunta mal solo
 * quedan publicas esas subcarpetas. Las URLs no cambian:
 * <prefijo>/<carpeta>/<archivo>, igual que la clave.
 */
export function serveLocalUploads(
  app: Pick<NestExpressApplication, 'useStaticAssets'>,
): void {
  const { root, prefix } = getLocalUploadMount();
  if (isUnsafeLocalUploadRoot(root)) {
    // Sin tumbar el arranque: el resto del API sigue y el estado del sistema
    // lo marca como error.
    logger.error(
      `LOCAL_UPLOAD_DIR (${root}) is the working directory or contains it: local uploads are NOT served, so the project files are not published. Point it to a dedicated folder.`,
    );
    return;
  }

  const base = prefix === '/' ? '' : prefix;
  for (const folder of getLocalUploadFolders()) {
    if (!isServableUploadFolder(folder)) {
      logger.error(
        `Upload folder "${folder}" (SPACES_UPLOAD_PREFIX) is not a plain relative path: it is not served.`,
      );
      continue;
    }
    app.useStaticAssets(path.join(root, ...folder.split('/')), {
      prefix: `${base}/${folder}`,
      index: false,
      redirect: false,
      fallthrough: true,
      dotfiles: 'ignore',
      // Las claves son unicas (uuid o timestamp) y no se sobrescriben.
      maxAge: '7d',
      immutable: true,
      setHeaders: setLocalUploadHeaders,
    });
  }
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
  const uploadPrefix = getEvidenceUploadFolder();

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
