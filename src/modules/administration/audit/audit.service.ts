import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { AuditQueryDto } from './dto/audit-query.dto';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: AuditQueryDto): Promise<AuditLog[]> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorUserId && { actorUserId: query.actorUserId }),
      // Entities were written with mixed casing (USER, User, DeliveryProof).
      ...(query.entityType && {
        entityType: { equals: query.entityType, mode: 'insensitive' },
      }),
      ...(query.entityId && { entityId: query.entityId }),
      ...(query.action && {
        action: { contains: query.action, mode: 'insensitive' },
      }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entityType: { contains: search, mode: 'insensitive' } },
        { entityId: { contains: search, mode: 'insensitive' } },
        { ipAddress: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(query.limit ?? 200, 1), 1000),
    });
  }
}
