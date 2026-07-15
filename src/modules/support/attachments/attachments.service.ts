import { Injectable } from '@nestjs/common';
import type { Attachment } from '@generated/prisma/client';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreateAttachmentDto } from './dto/create-attachment.dto';

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
