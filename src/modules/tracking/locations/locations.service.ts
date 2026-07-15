import { Injectable } from '@nestjs/common';
import type { DriverLocation } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { CreateLocationDto } from './dto/create-location.dto';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateLocationDto): Promise<DriverLocation> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const location = await tx.driverLocation.create({
        data: {
          driverId: dto.driverId,
          orderId: dto.orderId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracy: dto.accuracy ?? null,
          speed: dto.speed ?? null,
          batteryLevel: dto.batteryLevel ?? null,
          recordedAt: dto.recordedAt ?? now,
          receivedAt: now,
        },
      });

      await tx.trackingSession.updateMany({
        where: { orderId: dto.orderId, driverId: dto.driverId, endedAt: null },
        data: { lastLocationAt: now },
      });

      return location;
    });
  }

  listByOrder(orderId: string): Promise<DriverLocation[]> {
    return this.prisma.driverLocation.findMany({
      where: { orderId },
      orderBy: { recordedAt: 'desc' },
      take: 100,
    });
  }

  latestByOrder(orderId: string): Promise<DriverLocation | null> {
    return this.prisma.driverLocation.findFirst({
      where: { orderId },
      orderBy: { recordedAt: 'desc' },
    });
  }
}
