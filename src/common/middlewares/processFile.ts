/* eslint-disable @typescript-eslint/no-misused-promises */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import sharp from 'sharp';

export interface UploadedFile {
  fieldName?: string;
  key: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
}

const s3Client = new S3Client({
  endpoint: process.env.SPACES_ENDPOINT,
  region: process.env.SPACES_REGION,
  credentials: {
    accessKeyId:
      process.env.SPACES_ACCESS_KEY_ID || process.env.ACCESS_KEY_ID || '',
    secretAccessKey:
      process.env.SPACES_SECRET_ACCESS_KEY ||
      process.env.ACCESS_SECRET_KEY ||
      '',
  },
});

const storage = multer.memoryStorage();

const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'video/mp4',
  'video/quicktime',
]);

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
  process.env.LOCAL_UPLOAD_DIR || path.join(__dirname, '..', 'public');

const buildLocalPublicUrl = (req: Request, key: string) => {
  const publicBase = process.env.LOCAL_UPLOAD_PUBLIC_URL?.replace(/\/+$/, '');
  if (publicBase) return `${publicBase}/${key}`;

  return `${req.protocol}://${req.get('host')}/${key}`;
};

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req: Request, file, cb) => {
    if (
      file.mimetype.startsWith('image/') ||
      allowedMimeTypes.has(file.mimetype)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Formato no soportado para evidencias.'));
    }
  },
}).any();

export const processFile = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  upload(req, res, async (err) => {
    if (err) {
      res.status(400).json({
        message: err instanceof Error ? err.message : 'Error to upload files',
      });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      next();
      return;
    }

    try {
      const bucketName = getBucketName();
      const uploadPrefix = process.env.SPACES_UPLOAD_PREFIX || 'evidences';
      const uploadedFiles = await Promise.all(
        files.map(async (file): Promise<UploadedFile> => {
          let fileBuffer = file.buffer;
          const originalName = sanitizeFileName(file.originalname);
          let fileName = `${randomUUID()}-${originalName}`;
          let fileKey = `${uploadPrefix}/${fileName}`;
          let contentType = file.mimetype;

          if (file.mimetype.startsWith('image/')) {
            fileName = `${fileName.replace(/\.[^.]+$/, '')}.webp`;
            fileKey = `${uploadPrefix}/${fileName}`;
            contentType = 'image/webp';
            fileBuffer = await sharp(file.buffer)
              .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
              .webp({ quality: 80 })
              .toBuffer();
          }

          if (bucketName) {
            await s3Client.send(
              new PutObjectCommand({
                Bucket: bucketName,
                Key: fileKey,
                Body: fileBuffer,
                ContentType: contentType,
                ACL: 'public-read',
              }),
            );
          } else {
            const localPath = path.join(
              getLocalPublicRoot(),
              ...fileKey.split('/'),
            );
            await mkdir(path.dirname(localPath), { recursive: true });
            await writeFile(localPath, fileBuffer);
          }

          return {
            fieldName: file.fieldname,
            key: fileKey,
            fileName,
            originalName: file.originalname,
            mimeType: contentType,
            size: fileBuffer.byteLength,
            url: bucketName
              ? buildPublicUrl(bucketName, fileKey)
              : buildLocalPublicUrl(req, fileKey),
          };
        }),
      );

      req.body.imageUrls = uploadedFiles.map((file) => file.url);
      req.body.uploadedFiles = uploadedFiles;
      next();
    } catch (error) {
      console.error('Error en subida:', error);
      res.status(500).json({ message: 'Error procesando archivos' });
    }
  });
};

export const processAndUpload = processFile;
