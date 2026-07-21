import { Injectable } from '@nestjs/common';
import type {
  Incident,
  IncidentComment,
  Prisma,
} from '@generated/prisma/client';
import { INCIDENT_STATUS } from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreateIncidentCommentDto } from './dto/create-incident-comment.dto';
import type { CreateIncidentDto } from './dto/create-incident.dto';
import type { IncidentQueryDto } from './dto/incident-query.dto';
import type { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: IncidentQueryDto): Promise<Incident[]> {
    const where: Prisma.IncidentWhereInput = {
      ...(query.orderId && { orderId: query.orderId }),
      ...(query.incidentType && { incidentType: query.incidentType }),
      ...(query.severity && { severity: query.severity }),
      ...(query.status && { status: query.status }),
      ...((query.from || query.to) && {
        reportedAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        {
          order: {
            is: { orderCode: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    return this.prisma.incident.findMany({
      where,
      include: {
        incidentsComments: true,
        order: { select: { id: true, orderCode: true, status: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { reportedAt: 'desc' },
    });
  }

  create(user: AuthenticatedUser, dto: CreateIncidentDto): Promise<Incident> {
    return this.prisma.incident.create({
      data: {
        orderId: dto.orderId,
        reportedBy: user.id,
        incidentType: dto.incidentType,
        severity: dto.severity,
        title: dto.title.trim(),
        description: dto.description.trim(),
        status: INCIDENT_STATUS.OPEN,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });
  }

  updateStatus(id: string, dto: UpdateIncidentStatusDto): Promise<Incident> {
    return this.prisma.incident.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === INCIDENT_STATUS.RESOLVED && {
          resolvedAt: new Date(),
        }),
      },
    });
  }

  addComment(
    user: AuthenticatedUser,
    incidentId: string,
    dto: CreateIncidentCommentDto,
  ): Promise<IncidentComment> {
    return this.prisma.incidentComment.create({
      data: {
        incidentId,
        userId: user.id,
        comment: dto.comment.trim(),
      },
    });
  }
}
