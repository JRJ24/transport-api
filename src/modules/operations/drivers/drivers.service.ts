import { Injectable } from '@nestjs/common';
import type { DriverProfile, Prisma } from '@generated/prisma/client';
import { STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import type { CreateDriverDto } from './dto/create-driver.dto';
import type { DriverQueryDto } from './dto/driver-query.dto';
import type { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import type { UpdateDriverVerificationDto } from './dto/update-driver-verification.dto';

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
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: DriverQueryDto): Promise<DriverProfile[]> {
    const where: Prisma.DriverProfileWhereInput = {
      ...(query.availabilityStatus && {
        availabilityStatus: query.availabilityStatus,
      }),
      ...(query.verificationStatus && {
        verificationStatus: query.verificationStatus,
      }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { licenseNumber: { contains: search, mode: 'insensitive' } },
        {
          user: {
            is: {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    return this.prisma.driverProfile.findMany({
      where,
      include: { user: { select: SAFE_USER_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string): Promise<DriverProfile | null> {
    return this.prisma.driverProfile.findUnique({
      where: { id },
      include: { user: { select: SAFE_USER_SELECT }, driverDocuments: true },
    });
  }

  findMine(userId: string): Promise<DriverProfile | null> {
    return this.prisma.driverProfile.findFirst({
      where: { userId },
      include: { user: { select: SAFE_USER_SELECT }, driverDocuments: true },
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
      include: { user: { select: SAFE_USER_SELECT } },
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
