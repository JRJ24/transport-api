import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DriverLocation } from '@generated/prisma/client';
import { ASSIGNMENT_STATUS, ROLES } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import type { CreateLocationDto } from './dto/create-location.dto';

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateLocationDto,
  ): Promise<DriverLocation> {
    const now = new Date();
    const driverId = await this.resolveDriverId(user, dto.driverId);

    await this.assertDriverCanTrackOrder(user, driverId, dto.orderId);

    const location = await this.prisma.$transaction(async (tx) => {
      const location = await tx.driverLocation.create({
        data: {
          driverId,
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
        where: { orderId: dto.orderId, driverId, endedAt: null },
        data: { lastLocationAt: now },
      });

      return location;
    });

    this.realtime.emitLocation(location);
    return location;
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
        message: 'Driver cannot publish location for another profile',
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
