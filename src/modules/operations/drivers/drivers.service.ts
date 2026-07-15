import { Injectable } from '@nestjs/common';
import type { DriverProfile } from '@generated/prisma/client';
import { STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import type { CreateDriverDto } from './dto/create-driver.dto';
import type { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import type { UpdateDriverVerificationDto } from './dto/update-driver-verification.dto';

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<DriverProfile[]> {
    return this.prisma.driverProfile.findMany({
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string): Promise<DriverProfile | null> {
    return this.prisma.driverProfile.findUnique({
      where: { id },
      include: { user: true, driverDocuments: true },
    });
  }

  findMine(userId: string): Promise<DriverProfile | null> {
    return this.prisma.driverProfile.findFirst({
      where: { userId },
      include: { user: true, driverDocuments: true },
    });
  }

  create(dto: CreateDriverDto): Promise<DriverProfile> {
    return this.prisma.driverProfile.create({
      data: {
        userId: dto.userId,
        licenseNumber: dto.licenseNumber.trim(),
        licenseExpiration: dto.licenseExpiration,
        availabilityStatus: dto.availabilityStatus ?? STATUS_DRIVER.OFFLINE,
        verificationStatus:
          dto.verificationStatus ?? VERIFICATION_STATUS.PENDING,
        ratingAVG: 0,
      },
      include: { user: true },
    });
  }

  updateStatus(id: string, dto: UpdateDriverStatusDto): Promise<DriverProfile> {
    return this.prisma.driverProfile.update({
      where: { id },
      data: { availabilityStatus: dto.availabilityStatus },
    });
  }

  updateVerification(
    id: string,
    dto: UpdateDriverVerificationDto,
  ): Promise<DriverProfile> {
    return this.prisma.driverProfile.update({
      where: { id },
      data: { verificationStatus: dto.verificationStatus },
    });
  }
}
