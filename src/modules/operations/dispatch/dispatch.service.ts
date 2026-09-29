import { Injectable } from '@nestjs/common';
import type { DriverOffer, OrderAssignment } from '@generated/prisma/client';
import {
  PAYMENT_STATUS,
  STATUS_DRIVER,
  STATUS_ORDERS,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { MatchingService } from '../matching/matching.service';
import type { MatchingResult } from '../matching/matching.types';
import { OffersService } from '../offers/offers.service';
import type {
  AssignCandidateDto,
  DispatchOrderDto,
} from './dto/dispatch-order.dto';

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
    private readonly matching: MatchingService,
    private readonly offersService: OffersService,
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

  /** Same ranking the automatic cascade uses, plus why others are out. */
  candidates(orderId: string): Promise<MatchingResult> {
    return this.matching.rankForOrder(orderId, { emitAlerts: true });
  }

  offers(orderId: string): Promise<DriverOffer[]> {
    return this.offersService.listForOrder(orderId);
  }

  assign(
    user: AuthenticatedUser,
    orderId: string,
    dto: AssignCandidateDto,
  ): Promise<OrderAssignment> {
    return this.offersService.manualAssign(user, orderId, dto);
  }

  /**
   * Legacy dispatch body. It now goes through the same revalidation and audit
   * as a pick from the ranking.
   */
  dispatch(
    user: AuthenticatedUser,
    dto: DispatchOrderDto,
  ): Promise<OrderAssignment> {
    return this.offersService.manualAssign(user, dto.orderId, {
      driverId: dto.driverId,
      vehicleId: dto.vehicleId,
      reason: dto.reason,
    });
  }
}
