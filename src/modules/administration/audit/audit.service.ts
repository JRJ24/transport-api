import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: {
    actorUserId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
  }): Promise<AuditLog[]> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorUserId && { actorUserId: query.actorUserId }),
      ...(query.entityType && { entityType: query.entityType }),
      ...(query.entityId && { entityId: query.entityId }),
      ...(query.action && { action: { contains: query.action } }),
    };

    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
