import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TrackingSession } from '@generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  ROLES,
  STATUS_ORDERS,
  TRACKING_SESSIONS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import type { StartTripDto } from './dto/start-trip.dto';

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async start(
    user: AuthenticatedUser,
    dto: StartTripDto,
  ): Promise<TrackingSession> {
    const now = new Date();
    const driverId = await this.resolveDriverId(user, dto.driverId);

    await this.assertDriverCanTrackOrder(user, driverId, dto.orderId);

    const session = await this.prisma.$transaction(async (tx) => {
      const session = await tx.trackingSession.create({
        data: {
          orderId: dto.orderId,
          driverId,
          startedAt: now,
          status: TRACKING_SESSIONS.ACTIVE,
          lastLocationAt: null,
        },
      });

      await tx.transportOrder.update({
        where: { id: dto.orderId },
        data: { status: STATUS_ORDERS.IN_PROGRESS, pickupAt: now },
      });

      return session;
    });

    this.realtime.emitTripEvent(dto.orderId, 'tracking:trip-started', session);
    return session;
  }

  async end(user: AuthenticatedUser, id: string): Promise<TrackingSession> {
    const now = new Date();
    const existing = await this.prisma.trackingSession.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Tracking session not found',
      });
    }

    await this.assertDriverCanTrackOrder(
      user,
      existing.driverId,
      existing.orderId,
    );

    const session = await this.prisma.trackingSession.update({
      where: { id },
      data: { status: TRACKING_SESSIONS.ENDED, endedAt: now },
    });

    this.realtime.emitTripEvent(
      session.orderId,
      'tracking:trip-ended',
      session,
    );
    return session;
  }

  listByOrder(orderId: string): Promise<TrackingSession[]> {
    return this.prisma.trackingSession.findMany({
      where: { orderId },
      orderBy: { startedAt: 'desc' },
    });
  }

  private async resolveDriverId(
    user: AuthenticatedUser,
    requestedDriverId: string,
  ): Promise<string> {
    if (!user.roles.includes(ROLES.DRIVER)) {
      return requestedDriverId;
    }

    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
    });

    if (!driver) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Driver profile not found',
      });
    }

    if (driver.id !== requestedDriverId) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Driver cannot manage tracking for another profile',
      });
    }

    return driver.id;
  }

  private async assertDriverCanTrackOrder(
    user: AuthenticatedUser,
    driverId: string,
    orderId: string,
  ): Promise<void> {
    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      return;
    }

    const assignment = await this.prisma.orderAssignment.findFirst({
      where: {
        driverId,
        orderId,
        assignmentStatus: {
          in: [ASSIGNMENT_STATUS.ACCEPTED],
        },
      },
    });

    if (!assignment) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Driver is not assigned to this order',
      });
    }
  }
}
