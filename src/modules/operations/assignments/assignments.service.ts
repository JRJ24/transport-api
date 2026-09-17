import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { OrderAssignment, Prisma } from '@generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  EVENT_TYPE,
  PAYMENT_STATUS,
  ROLES,
  STATUS_DRIVER,
  STATUS_ORDERS,
  STATUS_VEHICLE,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import { orderStatusLabel } from '@/modules/support/notifications/templates/notification.templates';
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

const ACTIVE_ASSIGNMENT_STATUSES: ASSIGNMENT_STATUS[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
];

const ACTIVE_ORDER_STATUSES: STATUS_ORDERS[] = [
  STATUS_ORDERS.ASSIGNED,
  STATUS_ORDERS.ACCEPTED,
  STATUS_ORDERS.IN_PROGRESS,
];

const DISPATCHABLE_PAYMENT_STATUSES: PAYMENT_STATUS[] = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.AUTHORIZED,
];

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationDispatcherService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Notifies the ORDER OWNER that its status changed (best-effort).
   *
   * Assignment and acceptance only ever reached operators and the driver, so a
   * customer had no way of learning that someone finally took the order.
   */
  private async notifyCustomerOrderStatus(
    orderId: string,
    status: STATUS_ORDERS,
  ): Promise<void> {
    try {
      const order = await this.prisma.transportOrder.findUnique({
        where: { id: orderId },
        select: { orderCode: true, customer: { select: { userId: true } } },
      });

      if (!order?.customer?.userId) {
        return;
      }

      await this.notifications.dispatch(
        order.customer.userId,
        'ORDER_STATUS_CHANGED',
        {
          orderId,
          orderCode: order.orderCode,
          status: orderStatusLabel(status),
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify customer of order status: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Broadcasts an order-status change and tells the customer about it.
   *
   * Realtime is fire-and-forget by design: an unreachable socket must never
   * roll back an assignment that already committed.
   */
  private announceOrderStatus(
    orderId: string,
    status: STATUS_ORDERS,
    previousStatus: STATUS_ORDERS,
    userId: string,
  ): void {
    this.realtime.emitOrderStatusChanged({
      orderId,
      status,
      previousStatus,
      changedByUserId: userId,
      changedAt: new Date().toISOString(),
    });
    void this.notifyCustomerOrderStatus(orderId, status);
  }

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
      select: { status: true, paymentStatus: true, vehicleCategoryId: true },
    });

    if (!currentOrder) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    if (
      currentOrder.status !== STATUS_ORDERS.REQUESTED ||
      !DISPATCHABLE_PAYMENT_STATUSES.includes(currentOrder.paymentStatus)
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Order must be paid or dispatch-authorized before assignment',
      });
    }

    await this.assertDriverVehicleCanTakeOrder(
      dto.driverId,
      dto.vehicleId,
      currentOrder.vehicleCategoryId,
    );

    const assignment = await this.prisma.$transaction(async (tx) => {
      const claimedOrder = await tx.transportOrder.updateMany({
        where: {
          id: dto.orderId,
          status: STATUS_ORDERS.REQUESTED,
          paymentStatus: { in: [...DISPATCHABLE_PAYMENT_STATUSES] },
          orderAssignments: {
            none: { assignmentStatus: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          },
        },
        data: { status: STATUS_ORDERS.ASSIGNED },
      });

      if (claimedOrder.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message: 'Order is no longer available for assignment',
        });
      }

      const claimedDriver = await tx.driverProfile.updateMany({
        where: {
          id: dto.driverId,
          availabilityStatus: STATUS_DRIVER.AVAILABLE,
        },
        data: { availabilityStatus: STATUS_DRIVER.BUSY },
      });

      if (claimedDriver.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message: 'Driver is no longer available',
        });
      }

      const created = await tx.orderAssignment.create({
        data: {
          orderId: dto.orderId,
          driverId: dto.driverId,
          vehicleId: dto.vehicleId,
          assignedBy: user.id,
          assignmentStatus: ASSIGNMENT_STATUS.PENDING,
        },
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
    this.announceOrderStatus(
      dto.orderId,
      STATUS_ORDERS.ASSIGNED,
      currentOrder.status,
      user.id,
    );
    return assignment;
  }

  async claimOrder(
    user: AuthenticatedUser,
    orderId: string,
    vehicleId: string,
  ): Promise<OrderAssignment> {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
      select: {
        id: true,
        availabilityStatus: true,
        verificationStatus: true,
        licenseExpiration: true,
      },
    });

    if (!driver) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Driver profile not found',
      });
    }

    this.assertDriverReady(driver);

    const order = await this.prisma.transportOrder.findUnique({
      where: { id: orderId },
      select: { status: true, paymentStatus: true, vehicleCategoryId: true },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    if (
      order.status !== STATUS_ORDERS.REQUESTED ||
      !DISPATCHABLE_PAYMENT_STATUSES.includes(order.paymentStatus)
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Order is not available for driver self-dispatch',
      });
    }

    await this.assertDriverHasNoActiveTrip(driver.id);
    await this.assertVehicleCanTakeOrder(
      vehicleId,
      driver.id,
      order.vehicleCategoryId,
    );

    const assignment = await this.prisma.$transaction(async (tx) => {
      const claimedOrder = await tx.transportOrder.updateMany({
        where: {
          id: orderId,
          status: STATUS_ORDERS.REQUESTED,
          paymentStatus: { in: [...DISPATCHABLE_PAYMENT_STATUSES] },
          orderAssignments: {
            none: { assignmentStatus: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          },
        },
        data: { status: STATUS_ORDERS.ACCEPTED },
      });

      if (claimedOrder.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message: 'Order was already taken by another driver',
        });
      }

      const claimedDriver = await tx.driverProfile.updateMany({
        where: { id: driver.id, availabilityStatus: STATUS_DRIVER.AVAILABLE },
        data: { availabilityStatus: STATUS_DRIVER.BUSY },
      });

      if (claimedDriver.count !== 1) {
        throw new ConflictException({
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message: 'Driver already has an active trip',
        });
      }

      const created = await tx.orderAssignment.create({
        data: {
          orderId,
          driverId: driver.id,
          vehicleId,
          assignedBy: null,
          assignmentStatus: ASSIGNMENT_STATUS.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      await this.recordEvent(tx, orderId, user.id, EVENT_TYPE.ACCEPTED);

      return created;
    });

    this.realtime.emitAssignmentCreated({
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      driverId: assignment.driverId,
      vehicleId: assignment.vehicleId,
      assignmentStatus: assignment.assignmentStatus,
      assignedAt: assignment.assignedAt.toISOString(),
    });
    this.announceOrderStatus(
      orderId,
      STATUS_ORDERS.ACCEPTED,
      STATUS_ORDERS.REQUESTED,
      user.id,
    );

    return assignment;
  }

  async accept(id: string, user: AuthenticatedUser): Promise<OrderAssignment> {
    const assignment = await this.prisma.$transaction(async (tx) => {
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

    this.announceOrderStatus(
      assignment.orderId,
      STATUS_ORDERS.ACCEPTED,
      STATUS_ORDERS.ASSIGNED,
      user.id,
    );

    return assignment;
  }

  async reject(id: string, user: AuthenticatedUser): Promise<OrderAssignment> {
    const assignment = await this.prisma.$transaction(async (tx) => {
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

    this.announceOrderStatus(
      assignment.orderId,
      STATUS_ORDERS.REQUESTED,
      STATUS_ORDERS.ASSIGNED,
      user.id,
    );

    return assignment;
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

  private async assertDriverVehicleCanTakeOrder(
    driverId: string,
    vehicleId: string,
    vehicleCategoryId: string,
  ): Promise<void> {
    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        availabilityStatus: true,
        verificationStatus: true,
        licenseExpiration: true,
      },
    });

    if (!driver) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Driver profile not found',
      });
    }

    this.assertDriverReady(driver);
    await this.assertDriverHasNoActiveTrip(driver.id);
    await this.assertVehicleCanTakeOrder(
      vehicleId,
      driver.id,
      vehicleCategoryId,
    );
  }

  private assertDriverReady(driver: {
    availabilityStatus: STATUS_DRIVER;
    verificationStatus: VERIFICATION_STATUS;
    licenseExpiration: Date;
  }): void {
    if (driver.verificationStatus !== VERIFICATION_STATUS.APPROVED) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Driver must be approved before taking orders',
      });
    }

    if (driver.availabilityStatus !== STATUS_DRIVER.AVAILABLE) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Driver is not available',
      });
    }

    if (driver.licenseExpiration.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Driver license is expired',
      });
    }
  }

  private async assertDriverHasNoActiveTrip(driverId: string): Promise<void> {
    const active = await this.prisma.orderAssignment.findFirst({
      where: {
        driverId,
        assignmentStatus: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        order: { status: { in: [...ACTIVE_ORDER_STATUSES] } },
      },
      select: { id: true },
    });

    if (active) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Driver already has an active trip',
      });
    }
  }

  private async assertVehicleCanTakeOrder(
    vehicleId: string,
    driverId: string,
    vehicleCategoryId: string,
  ): Promise<void> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, driverId },
      select: { id: true, status: true, categoryId: true },
    });

    if (!vehicle) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Vehicle not found for this driver',
      });
    }

    if (vehicle.status !== STATUS_VEHICLE.ACTIVE) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Vehicle must be active to take orders',
      });
    }

    if (vehicle.categoryId !== vehicleCategoryId) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Vehicle category does not match the order category',
      });
    }
  }
}
