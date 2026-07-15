import { Injectable } from '@nestjs/common';
import type { OrderAssignment } from '@generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  STATUS_DRIVER,
  STATUS_ORDERS,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { DispatchOrderDto } from './dto/dispatch-order.dto';

@Injectable()
export class DispatchService {
  constructor(private readonly prisma: PrismaService) {}

  pendingOrders() {
    return this.prisma.transportOrder.findMany({
      where: { status: STATUS_ORDERS.REQUESTED },
      include: { orderStops: true, orderItems: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  availableDrivers() {
    return this.prisma.driverProfile.findMany({
      where: {
        availabilityStatus: STATUS_DRIVER.AVAILABLE,
        verificationStatus: VERIFICATION_STATUS.APPROVED,
      },
      include: { user: true },
      orderBy: { ratingAVG: 'desc' },
    });
  }

  dispatch(
    user: AuthenticatedUser,
    dto: DispatchOrderDto,
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

      return assignment;
    });
  }
}
