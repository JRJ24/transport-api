import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Incident,
  IncidentComment,
  Prisma,
} from '@generated/prisma/client';
import {
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
  ROLES,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import { EvidenceAccessService } from '../evidence-access/evidence-access.service';
import type { CreateIncidentCommentDto } from './dto/create-incident-comment.dto';
import type { CreateIncidentDto } from './dto/create-incident.dto';
import type { IncidentQueryDto } from './dto/incident-query.dto';
import type { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';

/**
 * Mensajes de los 403. Las apps muestran el mensaje tal cual en un toast, por
 * eso hablan de incidencias y no del "evidence" generico de
 * EvidenceAccessService (el codigo FORBIDDEN es el mismo).
 */
export const INCIDENT_LIST_DENIED =
  'You cannot access the incidents of this order';
export const INCIDENT_REPORT_DENIED =
  'You cannot report incidents for this order';
export const INCIDENT_COMMENT_DENIED = 'You cannot comment on this incident';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationDispatcherService,
    private readonly access: EvidenceAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: IncidentQueryDto,
  ): Promise<Incident[]> {
    // El portal (staff) filtra libremente. Conductor y cliente solo ven las
    // incidencias de una orden suya: sin orderId el listado devolvia las de
    // todas las ordenes (descripcion, ubicacion, respuestas de la torre y el
    // email de quien reporto). Lectura: mismo alcance que ver la evidencia.
    const staff = this.access.isStaff(user);
    if (!staff) {
      if (!query.orderId) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: 'orderId is required',
        });
      }
      await this.access.assertOrderAccess(user, query.orderId, {
        message: INCIDENT_LIST_DENIED,
      });
    }

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
        // El email de quien reporto solo lo necesita el portal. Al cliente le
        // daria el email del conductor (y al reves), y ninguna app lo usa.
        user: { select: { id: true, fullName: true, email: staff } },
      },
      orderBy: { reportedAt: 'desc' },
    });
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateIncidentDto,
  ): Promise<Incident> {
    await this.assertCanWriteOrder(user, dto.orderId, INCIDENT_REPORT_DENIED);

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

  /**
   * Escalating raises the severity one level, puts the incident in review
   * and leaves a trace in its comments; operators are notified as for any
   * incident update.
   */
  async escalate(
    user: AuthenticatedUser,
    id: string,
    reason?: string,
  ): Promise<Incident> {
    const current = await this.prisma.incident.findUnique({
      where: { id },
      select: { severity: true, status: true },
    });
    if (!current) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Incident not found',
      });
    }
    if (
      current.status === INCIDENT_STATUS.RESOLVED ||
      current.status === INCIDENT_STATUS.CLOSED
    ) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'A resolved or closed incident cannot be escalated',
      });
    }
    const ladder = [
      INCIDENT_SEVERITY.LOW,
      INCIDENT_SEVERITY.MEDIUM,
      INCIDENT_SEVERITY.HIGH,
      INCIDENT_SEVERITY.CRITICAL,
    ];
    const next =
      ladder[Math.min(ladder.indexOf(current.severity) + 1, ladder.length - 1)];

    const incident = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.incident.update({
        where: { id },
        data: { severity: next, status: INCIDENT_STATUS.IN_REVIEW },
      });
      await tx.incidentComment.create({
        data: {
          incidentId: id,
          userId: user.id,
          comment: `Escalada a severidad ${next}${reason?.trim() ? `: ${reason.trim()}` : ''}`,
        },
      });
      return updated;
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
          `Failed to notify operators about escalation: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
    );
    return incident;
  }

  async addComment(
    user: AuthenticatedUser,
    incidentId: string,
    dto: CreateIncidentCommentDto,
  ): Promise<IncidentComment> {
    // Staff (portal / torre de control) comenta cualquier incidencia, como
    // antes. Conductor y cliente antes podian colgar comentarios en
    // incidencias de ordenes ajenas: el insert no miraba de quien era.
    if (!this.access.isStaff(user)) {
      const incident = await this.prisma.incident.findUnique({
        where: { id: incidentId },
        select: { orderId: true },
      });
      // Mismo 403 exista o no la incidencia, para no revelar ids ajenos.
      if (!incident) {
        throw this.denied(INCIDENT_COMMENT_DENIED);
      }
      await this.assertCanWriteOrder(
        user,
        incident.orderId,
        INCIDENT_COMMENT_DENIED,
      );
    }

    return this.prisma.incidentComment.create({
      data: {
        incidentId,
        userId: user.id,
        comment: dto.comment.trim(),
      },
    });
  }

  /**
   * Escribir en las incidencias de una orden (reportar o comentar). Es la
   * regla de la evidencia en modo escritura: staff libre; conductor solo con
   * una asignacion que lo deje escribir evidencia (no basta una
   * REJECTED/CANCELLED, ni una oferta que todavia no acepto); cliente solo en
   * su propia orden, que es lo que usa IncidentsPanel en app-customers. Antes
   * al conductor le bastaba cualquier asignacion, y al cliente una orden
   * inexistente le daba 404 en vez de 403 (revelaba que ids existen).
   *
   * assertOrderAccess con allowCustomer explicito y no assertEntityAccess
   * ('ORDER', 'write'): ese camino es el de los adjuntos, donde el cliente ya
   * no puede subir archivos. Reportar y comentar si son del cliente. El 403
   * sale con el mensaje de incidencias (INCIDENT_*_DENIED); cualquier otro
   * error sube tal cual.
   */
  private assertCanWriteOrder(
    user: AuthenticatedUser,
    orderId: string,
    message: string,
  ): Promise<void> {
    return this.access.assertOrderAccess(user, orderId, {
      mode: 'write',
      allowCustomer: true,
      message,
    });
  }

  private denied(message: string): ForbiddenException {
    return new ForbiddenException({ code: ERROR_CODES.FORBIDDEN, message });
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
