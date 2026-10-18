import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
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

interface AttachmentEntity {
  entityType: string;
  entityId: string;
}

/** Mismo mensaje en list() y upload(): las apps ya lo conocen. */
const ENTITY_REQUIRED_MESSAGE = 'entityType and entityId are required';

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EvidenceAccessService,
  ) {}

  /**
   * POST /attachments: registra metadata con un fileUrl arbitrario, sin subir
   * nada. Solo staff (el controller ya lo restringe; esto es por si otro
   * llamador lo reutiliza): un conductor podia colgar de su prueba la URL de
   * cualquier imagen publica, incluida la foto de otro conductor, y con eso
   * pasar assertDeliveryEvidenceReady sin haber fotografiado la entrega.
   * Ninguna app de conductor o cliente lo usa; suben con /attachments/upload.
   */
  async create(
    user: AuthenticatedUser,
    dto: CreateAttachmentDto,
  ): Promise<Attachment> {
    if (!this.access.isStaff(user)) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message:
          'Only staff can register attachment metadata; upload the file instead',
      });
    }

    return this.prisma.attachment.create({
      data: {
        entityType: dto.entityType.trim(),
        entityId: dto.entityId.trim(),
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
   * POST /attachments/upload. Orden importante: primero validar la entidad y
   * autorizar, despues escribir en el storage, para que un 400/403 no deje
   * archivos publicos huerfanos.
   */
  async upload(
    user: AuthenticatedUser,
    files: Express.Multer.File[] | undefined,
    dto: UploadAttachmentsDto,
    req: Request,
  ): Promise<UploadedAttachment[]> {
    const entity = this.resolveUploadEntity(user, dto);

    if (entity) {
      await this.access.assertEntityAccess(
        user,
        entity.entityType,
        entity.entityId,
        'write',
      );
    }

    if (!files || files.length === 0) {
      return [];
    }

    const stored = await processUploadedFiles(files, req);
    return this.createFromUploadedFiles(user, stored, entity);
  }

  /**
   * Entidad a la que se cuelgan los archivos subidos, ya recortada (Length(2,
   * 80) del DTO deja pasar '  ', que recortado queda vacio).
   * - Conductor o cliente: obligatoria. Sin ella el archivo quedaba publicado
   *   sin dueno y sin pasar por ninguna verificacion de acceso.
   * - Staff: puede subir solo el archivo (attachment null), como antes; pero
   *   mandar solo uno de los dos campos es un error, no "sin entidad".
   */
  private resolveUploadEntity(
    user: AuthenticatedUser,
    dto: UploadAttachmentsDto,
  ): AttachmentEntity | null {
    const entityType = dto.entityType?.trim() ?? '';
    const entityId = dto.entityId?.trim() ?? '';

    if (entityType && entityId) {
      return { entityType, entityId };
    }

    if (!this.access.isStaff(user)) {
      throw this.entityRequired();
    }

    if (entityType || entityId) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'entityType and entityId must be sent together',
      });
    }

    return null;
  }

  /**
   * Solo para archivos ya autorizados y guardados (ver upload). Privado: no
   * verifica acceso, y antes el controller lo llamaba directo.
   */
  private async createFromUploadedFiles(
    user: AuthenticatedUser,
    files: UploadedFile[],
    entity: AttachmentEntity | null,
  ): Promise<UploadedAttachment[]> {
    return Promise.all(
      files.map(async (file) => {
        const attachment = entity
          ? await this.prisma.attachment.create({
              data: {
                entityType: entity.entityType,
                entityId: entity.entityId,
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
      throw this.entityRequired();
    }

    await this.access.assertEntityAccess(user, type, id, 'read');

    return this.prisma.attachment.findMany({
      where: { entityType: type, entityId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  private entityRequired(): BadRequestException {
    return new BadRequestException({
      code: ERROR_CODES.BAD_REQUEST,
      message: ENTITY_REQUIRED_MESSAGE,
    });
  }
}
