import { ForbiddenException, Injectable } from '@nestjs/common';
import type { DriverProfile, Prisma } from '@generated/prisma/client';
import { ROLES, STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
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

  async updateStatus(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateDriverStatusDto,
  ): Promise<DriverProfile> {
    if (
      user.roles.includes(ROLES.DRIVER) &&
      !user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      const driver = await this.prisma.driverProfile.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!driver || driver.id !== id) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'You cannot update another driver profile',
        });
      }
    }

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
