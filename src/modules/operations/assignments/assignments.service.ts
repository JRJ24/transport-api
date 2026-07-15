import { Injectable } from '@nestjs/common';
import type { OrderAssignment, Prisma } from '@generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  EVENT_TYPE,
  STATUS_DRIVER,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreateAssignmentDto } from './dto/create-assignment.dto';

@Injectable()
export class AssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<OrderAssignment[]> {
    return this.prisma.orderAssignment.findMany({
      include: {
        order: true,
        driver: { include: { user: true } },
        vehicle: true,
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  create(
    user: AuthenticatedUser,
    dto: CreateAssignmentDto,
  ): Promise<OrderAssignment> {
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.orderAssignment.create({
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

      return assignment;
    });
  }

  accept(id: string, user: AuthenticatedUser): Promise<OrderAssignment> {
    return this.prisma.$transaction(async (tx) => {
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
}
