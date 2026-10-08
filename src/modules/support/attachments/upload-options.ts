import { BadRequestException } from '@nestjs/common';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import multer from 'multer';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { isAllowedUploadMimeType } from '@/common/middlewares/processFile';

/** Mismo tope por peticion que tenia el middleware processFile. */
export const MAX_FILES_PER_UPLOAD = 10;
const DEFAULT_MAX_UPLOAD_MB = 50;

/**
 * Opciones de Multer para POST /attachments/upload. Memoria y no disco: el
 * archivo solo se escribe en el storage despues de autorizar, desde
 * AttachmentsService. El interceptor corre despues de los guards, asi que una
 * peticion sin token se rechaza sin llegar a leer el multipart.
 */
export function buildEvidenceUploadOptions(
  maxUploadMb: number,
): MulterModuleOptions {
  const maxMb =
    Number.isFinite(maxUploadMb) && maxUploadMb > 0
      ? maxUploadMb
      : DEFAULT_MAX_UPLOAD_MB;

  return {
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxMb * 1024 * 1024,
      files: MAX_FILES_PER_UPLOAD,
    },
    fileFilter: (_req, file, cb) => {
      if (isAllowedUploadMimeType(file.mimetype)) {
        cb(null, true);
        return;
      }
      // HttpException: el interceptor la deja pasar tal cual (400 con el
      // sobre de error estandar) en vez de convertirla en un 500.
      cb(
        new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'Formato no soportado para evidencias.',
        }),
        false,
      );
    },
  };
}
