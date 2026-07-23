import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { OrderAssignment, Prisma } from '@generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  EVENT_TYPE,
  ROLES,
  STATUS_DRIVER,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import type { CreateAssignmentDto } from './dto/create-assignment.dto';

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationDispatcherService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Notifies the assigned driver about a new order (best-effort). */
  private async notifyDriverAssigned(
    driverId: string,
    orderId: string,
  ): Promise<void> {
    try {
      const [driver, order] = await Promise.all([
        this.prisma.driverProfile.findUnique({
          where: { id: driverId },
          select: { userId: true },
        }),
        this.prisma.transportOrder.findUnique({
          where: { id: orderId },
          select: { orderCode: true },
        }),
      ]);
      if (driver) {
        await this.notifications.dispatch(driver.userId, 'ORDER_ASSIGNED', {
          orderId,
          orderCode: order?.orderCode,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to notify driver of assignment: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  list(): Promise<OrderAssignment[]> {
    return this.prisma.orderAssignment.findMany({
      include: {
        order: true,
        driver: { include: { user: { select: SAFE_USER_SELECT } } },
        vehicle: true,
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async listMine(user: AuthenticatedUser): Promise<OrderAssignment[]> {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
    });

    if (!driver) {
      return [];
    }

    return this.prisma.orderAssignment.findMany({
      where: { driverId: driver.id },
      include: {
        order: { include: { orderStops: true, orderItems: true } },
        driver: { include: { user: { select: SAFE_USER_SELECT } } },
        vehicle: true,
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateAssignmentDto,
  ): Promise<OrderAssignment> {
    const currentOrder = await this.prisma.transportOrder.findUnique({
      where: { id: dto.orderId },
      select: { status: true },
    });

    const assignment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.orderAssignment.create({
        data: {
          orderId: dto.orderId,
          driverId: dto.driverId,
          vehicleId: dto.vehicleId,
          assignedBy: user.id,
          assignmentStatus: ASSIGNMENT_STATUS.PENDING,
        },
      });

      await tx.transportOrder.update({
        where: { id: dto.orderId },
        data: { status: STATUS_ORDERS.ASSIGNED },
      });
      await tx.driverProfile.update({
        where: { id: dto.driverId },
        data: { availabilityStatus: STATUS_DRIVER.BUSY },
      });
      await this.recordEvent(tx, dto.orderId, user.id, EVENT_TYPE.ASSIGNED);

      return created;
    });

    await this.notifyDriverAssigned(dto.driverId, dto.orderId);
    this.realtime.emitAssignmentCreated({
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      driverId: assignment.driverId,
      vehicleId: assignment.vehicleId,
      assignmentStatus: assignment.assignmentStatus,
      assignedAt: assignment.assignedAt.toISOString(),
    });
    this.realtime.emitOrderStatusChanged({
      orderId: dto.orderId,
      status: STATUS_ORDERS.ASSIGNED,
      previousStatus: currentOrder?.status,
      changedByUserId: user.id,
      changedAt: new Date().toISOString(),
    });
    return assignment;
  }

  accept(id: string, user: AuthenticatedUser): Promise<OrderAssignment> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCanMutateAssignment(tx, id, user);
      const assignment = await tx.orderAssignment.update({
        where: { id },
        data: {
          assignmentStatus: ASSIGNMENT_STATUS.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      await tx.transportOrder.update({
        where: { id: assignment.orderId },
        data: { status: STATUS_ORDERS.ACCEPTED },
      });
      await this.recordEvent(
        tx,
        assignment.orderId,
        user.id,
        EVENT_TYPE.ACCEPTED,
      );

      return assignment;
    });
  }

  reject(id: string, user: AuthenticatedUser): Promise<OrderAssignment> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCanMutateAssignment(tx, id, user);
      const assignment = await tx.orderAssignment.update({
        where: { id },
        data: {
          assignmentStatus: ASSIGNMENT_STATUS.REJECTED,
          rejectedAt: new Date(),
        },
      });

      await tx.transportOrder.update({
        where: { id: assignment.orderId },
        data: { status: STATUS_ORDERS.REQUESTED },
      });
      await tx.driverProfile.update({
        where: { id: assignment.driverId },
        data: { availabilityStatus: STATUS_DRIVER.AVAILABLE },
      });

      await this.recordEvent(
        tx,
        assignment.orderId,
        user.id,
        EVENT_TYPE.CANCELLED,
      );

      return assignment;
    });
  }

  complete(id: string): Promise<OrderAssignment> {
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.orderAssignment.update({
        where: { id },
        data: { assignmentStatus: ASSIGNMENT_STATUS.COMPLETED },
      });

      await tx.driverProfile.update({
        where: { id: assignment.driverId },
        data: { availabilityStatus: STATUS_DRIVER.AVAILABLE },
      });

      return assignment;
    });
  }

  private recordEvent(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorUserId: string,
    eventType: EVENT_TYPE,
  ) {
    return tx.orderEvent.create({
      data: {
        orderId,
        eventType,
        actorUserId,
        description: `Assignment event: ${eventType}`,
        metadata: { source: 'operations' },
        latitude: null,
        longitude: 0,
      },
    });
  }

  private async assertCanMutateAssignment(
    tx: Prisma.TransactionClient,
    assignmentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      return;
    }

    const driver = await tx.driverProfile.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });
    const assignment = await tx.orderAssignment.findUnique({
      where: { id: assignmentId },
      select: { driverId: true },
    });

    if (!assignment) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Assignment not found',
      });
    }

    if (!driver || assignment.driverId !== driver.id) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You cannot mutate another driver assignment',
      });
    }
  }
}
