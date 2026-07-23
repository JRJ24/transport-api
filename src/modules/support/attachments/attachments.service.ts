import { Injectable } from '@nestjs/common';
import type { Attachment } from '@generated/prisma/client';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { UploadedFile } from '@/common/middlewares/processFile';
import { PrismaService } from '@/database/prisma.service';
import type { CreateAttachmentDto } from './dto/create-attachment.dto';

export interface UploadedAttachment {
  file: UploadedFile;
  attachment: Attachment | null;
}

@Injectable()
export class AttachmentsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    user: AuthenticatedUser,
    dto: CreateAttachmentDto,
  ): Promise<Attachment> {
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

  list(entityType?: string, entityId?: string): Promise<Attachment[]> {
    return this.prisma.attachment.findMany({
      where: {
        ...(entityType && { entityType }),
        ...(entityId && { entityId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
