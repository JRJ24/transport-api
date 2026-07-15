import { Injectable } from '@nestjs/common';
import type { TrackingSession } from '@generated/prisma/client';
import { STATUS_ORDERS, TRACKING_SESSIONS } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import type { StartTripDto } from './dto/start-trip.dto';

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  start(dto: StartTripDto): Promise<TrackingSession> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.trackingSession.create({
        data: {
          orderId: dto.orderId,
          driverId: dto.driverId,
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
  }

  end(id: string): Promise<TrackingSession> {
    const now = new Date();

    return this.prisma.trackingSession.update({
      where: { id },
      data: { status: TRACKING_SESSIONS.ENDED, endedAt: now },
    });
  }

  listByOrder(orderId: string): Promise<TrackingSession[]> {
    return this.prisma.trackingSession.findMany({
      where: { orderId },
      orderBy: { startedAt: 'desc' },
    });
  }
}
