import { Injectable } from '@nestjs/common';
import type { OrderAssignment } from '@generated/prisma/client';
import {
  PAYMENT_STATUS,
  STATUS_DRIVER,
  STATUS_ORDERS,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { AssignmentsService } from '../assignments/assignments.service';
import type { DispatchOrderDto } from './dto/dispatch-order.dto';

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
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignments: AssignmentsService,
  ) {}

  pendingOrders() {
    return this.prisma.transportOrder.findMany({
      where: {
        status: STATUS_ORDERS.REQUESTED,
        paymentStatus: { in: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.AUTHORIZED] },
      },
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
      include: { user: { select: SAFE_USER_SELECT } },
      orderBy: { ratingAVG: 'desc' },
    });
  }

  dispatch(
    user: AuthenticatedUser,
    dto: DispatchOrderDto,
  ): Promise<OrderAssignment> {
    return this.assignments.create(user, dto);
  }
}
