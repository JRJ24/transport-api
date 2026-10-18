import { BadRequestException } from '@nestjs/common';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import multer from 'multer';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { isAllowedUploadMimeType } from '@/common/middlewares/processFile';

/**
 * Archivos por peticion. Multer los guarda en RAM antes de que
 * AttachmentsService pueda responder 403, asi que el tope acota lo que una
 * sola peticion autenticada (pero ajena a la entidad) retiene en memoria:
 * MAX_FILES_PER_UPLOAD x MAX_UPLOAD_MB. Las dos apps de conductor mandan 2
 * (foto + firma) y el portal no sube; 5 deja margen. Antes eran 10.
 */
export const MAX_FILES_PER_UPLOAD = 5;
/**
 * Campos de texto: solo entityType y entityId (el resto da 400 por
 * forbidNonWhitelisted, pero Multer ya los habria leido). Por defecto busboy
 * acepta infinitos campos de 1 MB cada uno, tambien en RAM.
 */
export const MAX_FIELDS_PER_UPLOAD = 5;
/** Bytes por campo: entityId mide como mucho 120 caracteres. */
export const MAX_FIELD_SIZE_BYTES = 1024;
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
      fields: MAX_FIELDS_PER_UPLOAD,
      fieldSize: MAX_FIELD_SIZE_BYTES,
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
