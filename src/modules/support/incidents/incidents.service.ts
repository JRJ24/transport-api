import { Injectable, Logger } from '@nestjs/common';
import type {
  Incident,
  IncidentComment,
  Prisma,
} from '@generated/prisma/client';
import { INCIDENT_STATUS, ROLES } from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import type { CreateIncidentCommentDto } from './dto/create-incident-comment.dto';
import type { CreateIncidentDto } from './dto/create-incident.dto';
import type { IncidentQueryDto } from './dto/incident-query.dto';
import type { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationDispatcherService,
  ) {}

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

  async create(
    user: AuthenticatedUser,
    dto: CreateIncidentDto,
  ): Promise<Incident> {
    const incident = await this.prisma.incident.create({
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

    this.realtime.emitIncidentCreated({
      incidentId: incident.id,
      orderId: incident.orderId,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      reportedBy: user.id,
      reportedAt: incident.reportedAt.toISOString(),
    });
    void this.notifyOperators('INCIDENT_CREATED', incident).catch(
      (error: unknown) =>
        this.logger.error(
          `Failed to notify operators about incident: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
    );

    return incident;
  }

  async updateStatus(
    id: string,
    dto: UpdateIncidentStatusDto,
  ): Promise<Incident> {
    const incident = await this.prisma.incident.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === INCIDENT_STATUS.RESOLVED && {
          resolvedAt: new Date(),
        }),
      },
    });

    this.realtime.emitIncidentUpdated({
      incidentId: incident.id,
      orderId: incident.orderId,
      status: incident.status,
      severity: incident.severity,
      updatedAt: new Date().toISOString(),
    });
    void this.notifyOperators('INCIDENT_UPDATED', incident).catch(
      (error: unknown) =>
        this.logger.error(
          `Failed to notify operators about incident update: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
    );

    return incident;
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

  private async notifyOperators(
    event: 'INCIDENT_CREATED' | 'INCIDENT_UPDATED',
    incident: Incident,
  ): Promise<void> {
    const [operators, order] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          userRoles: {
            some: {
              rol: { code: { in: [ROLES.ADMIN, ROLES.OPERATOR] } },
            },
          },
        },
        select: { id: true },
      }),
      this.prisma.transportOrder.findUnique({
        where: { id: incident.orderId },
        select: { orderCode: true },
      }),
    ]);

    await Promise.allSettled(
      operators.map((operator) =>
        this.notifications.dispatch(operator.id, event, {
          incidentId: incident.id,
          orderId: incident.orderId,
          orderCode: order?.orderCode,
          message: `${incident.title} · ${incident.severity}`,
          status: incident.status,
        }),
      ),
    );
  }
}
