import { Injectable } from '@nestjs/common';
import type { Incident, IncidentComment } from '@generated/prisma/client';
import { INCIDENT_STATUS } from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreateIncidentCommentDto } from './dto/create-incident-comment.dto';
import type { CreateIncidentDto } from './dto/create-incident.dto';
import type { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(orderId?: string): Promise<Incident[]> {
    return this.prisma.incident.findMany({
      where: { ...(orderId && { orderId }) },
      include: { incidentsComments: true },
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
