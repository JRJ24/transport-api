import { Injectable } from '@nestjs/common';
import type { DriverOffer, OrderAssignment } from '@generated/prisma/client';
import {
  PAYMENT_STATUS,
  STATUS_DRIVER,
  STATUS_VEHICLE,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import { DISPATCH_WAITING_STATUSES } from '@/common/constants/order-status.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { MatchingService } from '../matching/matching.service';
import type { MatchingResult } from '../matching/matching.types';
import { OffersService } from '../offers/offers.service';
import { PresenceService } from '../presence/presence.service';
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
    private readonly presence: PresenceService,
  ) {}

  pendingOrders() {
    return this.prisma.transportOrder.findMany({
      where: {
        status: { in: DISPATCH_WAITING_STATUSES },
        paymentStatus: { in: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.AUTHORIZED] },
      },
      include: { orderStops: true, orderItems: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Available, approved drivers. With `orderId`, only those with an active
   * vehicle of the order's category, so a pick can never end in an empty
   * vehicle list. The ranking (`candidates`) is the preferred view.
   */
  async availableDrivers(orderId?: string) {
    let driverIds: string[] | undefined;
    if (orderId) {
      const order = await this.prisma.transportOrder.findUnique({
        where: { id: orderId },
        select: { vehicleCategoryId: true },
      });
      const vehicles = order
        ? await this.prisma.vehicle.findMany({
            where: {
              categoryId: order.vehicleCategoryId,
              status: STATUS_VEHICLE.ACTIVE,
            },
            select: { driverId: true },
          })
        : [];
      driverIds = [...new Set(vehicles.map((vehicle) => vehicle.driverId))];
    }

    return this.prisma.driverProfile.findMany({
      where: {
        availabilityStatus: STATUS_DRIVER.AVAILABLE,
        verificationStatus: VERIFICATION_STATUS.APPROVED,
        licenseExpiration: { gt: new Date() },
        ...(driverIds && { id: { in: driverIds } }),
      },
      include: { user: { select: SAFE_USER_SELECT } },
      orderBy: { ratingAVG: 'desc' },
    });
  }

  /** Available drivers with a fresh H3 position, for the live map. */
  async liveDrivers() {
    const presence = await this.presence.listFresh();
    if (presence.length === 0) {
      return [];
    }
    const drivers = await this.prisma.driverProfile.findMany({
      where: { id: { in: presence.map((record) => record.driverId) } },
      select: { id: true, user: { select: { fullName: true } } },
    });
    const names = new Map(drivers.map((d) => [d.id, d.user?.fullName ?? null]));
    return presence.map((record) => ({
      driverId: record.driverId,
      driverName: names.get(record.driverId) ?? null,
      latitude: record.latitude,
      longitude: record.longitude,
      accuracyM: record.accuracyM,
      heading: record.heading,
      h3Cell: record.h3Cell,
      status: record.status,
      observedAt: record.observedAt.toISOString(),
    }));
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
