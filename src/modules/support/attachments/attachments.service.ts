import { BadRequestException, Injectable } from '@nestjs/common';
import type { Attachment } from '@generated/prisma/client';
import type { Request } from 'express';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import {
  processUploadedFiles,
  type UploadedFile,
} from '@/common/middlewares/processFile';
import { PrismaService } from '@/database/prisma.service';
import { EvidenceAccessService } from '../evidence-access/evidence-access.service';
import type { CreateAttachmentDto } from './dto/create-attachment.dto';
import type { UploadAttachmentsDto } from './dto/upload-attachments.dto';

export interface UploadedAttachment {
  file: UploadedFile;
  attachment: Attachment | null;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EvidenceAccessService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateAttachmentDto,
  ): Promise<Attachment> {
    const entityType = dto.entityType.trim();
    const entityId = dto.entityId.trim();
    await this.access.assertEntityAccess(user, entityType, entityId, 'write');

    return this.prisma.attachment.create({
      data: {
        entityType,
        entityId,
        fileName: dto.fileName.trim(),
        fileUrl: dto.fileUrl.trim(),
        fileSize: dto.fileSize,
        mimeType: dto.mimeType.trim(),
        uploadedBy: user.id,
        createdAt: new Date(),
      },
    });
  }

  /**
   * POST /attachments/upload. Orden importante: primero autorizar y despues
   * escribir en el storage, para que un 403 no deje archivos publicos
   * huerfanos. Sin entityType+entityId solo se sube el archivo (attachment
   * null), permitido a cualquier usuario autenticado como hasta ahora.
   */
  async upload(
    user: AuthenticatedUser,
    files: Express.Multer.File[] | undefined,
    dto: UploadAttachmentsDto,
    req: Request,
  ): Promise<UploadedAttachment[]> {
    const entityType = dto.entityType?.trim();
    const entityId = dto.entityId?.trim();

    if (entityType && entityId) {
      await this.access.assertEntityAccess(user, entityType, entityId, 'write');
    }

    if (!files || files.length === 0) {
      return [];
    }

    const stored = await processUploadedFiles(files, req);
    return this.createFromUploadedFiles(user, stored, entityType, entityId);
  }

  /** Solo para archivos ya autorizados y guardados (ver upload). */
  async createFromUploadedFiles(
    user: AuthenticatedUser,
    files: UploadedFile[],
    entityType?: string,
    entityId?: string,
  ): Promise<UploadedAttachment[]> {
    const normalizedEntityType = entityType?.trim();
    const normalizedEntityId = entityId?.trim();

    return Promise.all(
      files.map(async (file) => {
        const attachment =
          normalizedEntityType && normalizedEntityId
            ? await this.prisma.attachment.create({
                data: {
                  entityType: normalizedEntityType,
                  entityId: normalizedEntityId,
                  fileName: file.fileName,
                  fileUrl: file.url,
                  fileSize: file.size,
                  mimeType: file.mimeType,
                  uploadedBy: user.id,
                  createdAt: new Date(),
                },
              })
            : null;

        return { file, attachment };
      }),
    );
  }

  async list(
    user: AuthenticatedUser,
    entityType?: string,
    entityId?: string,
  ): Promise<Attachment[]> {
    // Staff (portal) sigue listando con filtros libres, como antes.
    if (this.access.isStaff(user)) {
      return this.prisma.attachment.findMany({
        where: {
          ...(entityType && { entityType }),
          ...(entityId && { entityId }),
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Conductor o cliente: sin entidad concreta el listado devolvia los
    // adjuntos de todas las ordenes.
    const type = entityType?.trim();
    const id = entityId?.trim();
    if (!type || !id) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'entityType and entityId are required',
      });
    }

    await this.access.assertEntityAccess(user, type, id, 'read');

    return this.prisma.attachment.findMany({
      where: { entityType: type, entityId: id },
      orderBy: { createdAt: 'desc' },
    });
  }
}
