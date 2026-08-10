import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { DriverProfile, Prisma, Vehicle } from '@generated/prisma/client';
import {
  ROLES,
  STATUS_ACCOUNT,
  STATUS_DRIVER,
  STATUS_VEHICLE,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { hashPassword } from '@/common/utils/hash.util';
import { PrismaService } from '@/database/prisma.service';
import type { CreateDriverDto } from './dto/create-driver.dto';
import type { DriverQueryDto } from './dto/driver-query.dto';
import type { RegisterDriverDto } from './dto/register-driver.dto';
import type { UpdateDriverDto } from './dto/update-driver.dto';
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

  async findMyVehicles(userId: string): Promise<Vehicle[]> {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId },
      select: { id: true },
    });

    if (!driver) {
      return [];
    }

    return this.prisma.vehicle.findMany({
      where: { driverId: driver.id },
      include: { vehicleCategory: true, vehiclesDocuments: true },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
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

  async update(
    id: string,
    dto: UpdateDriverDto,
    actorUserId: string,
  ): Promise<DriverProfile> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.driverProfile.findUnique({
        where: { id },
        include: { user: { select: SAFE_USER_SELECT } },
      });
      const driver = await tx.driverProfile.update({
        where: { id },
        data: {
          ...(dto.userId !== undefined && { userId: dto.userId }),
          ...(dto.licenseNumber !== undefined && {
            licenseNumber: dto.licenseNumber.trim(),
          }),
          ...(dto.licenseExpiration !== undefined && {
            licenseExpiration: dto.licenseExpiration,
          }),
          ...(dto.availabilityStatus !== undefined && {
            availabilityStatus: dto.availabilityStatus,
          }),
          ...(dto.verificationStatus !== undefined && {
            verificationStatus: dto.verificationStatus,
          }),
        },
        include: { user: { select: SAFE_USER_SELECT } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'DRIVER_UPDATED',
          entityType: 'DRIVER',
          entityId: id,
          ...(existing && {
            oldValues: {
              userId: existing.userId,
              licenseNumber: existing.licenseNumber,
              licenseExpiration: existing.licenseExpiration.toISOString(),
              availabilityStatus: existing.availabilityStatus,
              verificationStatus: existing.verificationStatus,
            },
          }),
          newValues: {
            userId: driver.userId,
            licenseNumber: driver.licenseNumber,
            licenseExpiration: driver.licenseExpiration.toISOString(),
            availabilityStatus: driver.availabilityStatus,
            verificationStatus: driver.verificationStatus,
          },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return driver;
    });
  }

  async register(dto: RegisterDriverDto): Promise<DriverProfile> {
    this.assertVehiclePayload(dto);

    const passwordHash = await hashPassword(
      dto.password,
      Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
    );

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: dto.fullName.trim(),
          email: dto.email.toLowerCase().trim(),
          phone: dto.phone.trim(),
          passwordHash,
          userRoles: {
            create: { rol: { connect: { code: ROLES.DRIVER } } },
          },
        },
      });

      const driver = await tx.driverProfile.create({
        data: {
          userId: user.id,
          licenseNumber: dto.licenseNumber.trim(),
          licenseExpiration: dto.licenseExpiration,
          availabilityStatus: STATUS_DRIVER.OFFLINE,
          verificationStatus: VERIFICATION_STATUS.PENDING,
          ratingAVG: 0,
        },
      });

      if (this.hasVehiclePayload(dto)) {
        await tx.vehicle.create({
          data: {
            driverId: driver.id,
            categoryId: dto.vehicleCategoryId!,
            plateNumber: dto.plateNumber!.trim().toUpperCase(),
            brand: dto.brand!.trim(),
            model: dto.model!.trim(),
            year: dto.year!,
            color: dto.color!.trim(),
            status: STATUS_VEHICLE.INACTIVE,
            createdAt: new Date(),
          },
        });
      }

      return tx.driverProfile.findUniqueOrThrow({
        where: { id: driver.id },
        include: { user: { select: SAFE_USER_SELECT }, driverDocuments: true },
      });
    });
  }

  async updateStatus(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateDriverStatusDto,
  ): Promise<DriverProfile> {
    if (
      user.roles.includes(ROLES.DRIVER) &&
      !user.roles.some(
        (role) => role === ROLES.ADMIN || role === ROLES.OPERATOR,
      )
    ) {
      const driver = await this.prisma.driverProfile.findFirst({
        where: { userId: user.id },
        select: { id: true, verificationStatus: true },
      });
      if (!driver || driver.id !== id) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'You cannot update another driver profile',
        });
      }
      if (driver.verificationStatus !== VERIFICATION_STATUS.APPROVED) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'Driver profile is pending approval',
        });
      }
    }

    return this.prisma.driverProfile.update({
      where: { id },
      data: { availabilityStatus: dto.availabilityStatus },
    });
  }

  async updateVerification(
    id: string,
    dto: UpdateDriverVerificationDto,
  ): Promise<DriverProfile> {
    return this.prisma.$transaction(async (tx) => {
      const driver = await tx.driverProfile.update({
        where: { id },
        data: {
          verificationStatus: dto.verificationStatus,
          ...(dto.verificationStatus === VERIFICATION_STATUS.REJECTED && {
            availabilityStatus: STATUS_DRIVER.OFFLINE,
          }),
        },
        include: { user: { select: SAFE_USER_SELECT } },
      });

      if (dto.verificationStatus === VERIFICATION_STATUS.APPROVED) {
        await tx.vehicle.updateMany({
          where: {
            driverId: id,
            status: { in: [STATUS_VEHICLE.INACTIVE, STATUS_VEHICLE.SUSPENDED] },
          },
          data: { status: STATUS_VEHICLE.ACTIVE },
        });
      }

      if (dto.verificationStatus === VERIFICATION_STATUS.REJECTED) {
        await tx.vehicle.updateMany({
          where: { driverId: id },
          data: { status: STATUS_VEHICLE.SUSPENDED },
        });
      }

      return driver;
    });
  }

  async softDelete(id: string, actorUserId: string): Promise<DriverProfile> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.driverProfile.findUnique({
        where: { id },
        include: { user: { select: SAFE_USER_SELECT } },
      });
      const driver = await tx.driverProfile.update({
        where: { id },
        data: { availabilityStatus: STATUS_DRIVER.SUSPENDED },
        include: { user: { select: SAFE_USER_SELECT } },
      });

      await tx.user.update({
        where: { id: driver.userId },
        data: { status: STATUS_ACCOUNT.INACTIVE },
      });
      await tx.vehicle.updateMany({
        where: { driverId: id },
        data: { status: STATUS_VEHICLE.SUSPENDED },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'DRIVER_SOFT_DELETED',
          entityType: 'DRIVER',
          entityId: id,
          ...(existing && {
            oldValues: {
              availabilityStatus: existing.availabilityStatus,
              userStatus: existing.user.status,
            },
          }),
          newValues: {
            availabilityStatus: STATUS_DRIVER.SUSPENDED,
            userStatus: STATUS_ACCOUNT.INACTIVE,
          },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return driver;
    });
  }

  private hasVehiclePayload(dto: RegisterDriverDto): boolean {
    return Boolean(
      dto.vehicleCategoryId ||
      dto.plateNumber ||
      dto.brand ||
      dto.model ||
      dto.year ||
      dto.color,
    );
  }

  private assertVehiclePayload(dto: RegisterDriverDto): void {
    if (!this.hasVehiclePayload(dto)) {
      return;
    }

    const missing = [
      ['vehicleCategoryId', dto.vehicleCategoryId],
      ['plateNumber', dto.plateNumber],
      ['brand', dto.brand],
      ['model', dto.model],
      ['year', dto.year],
      ['color', dto.color],
    ]
      .filter(([, value]) => value === undefined || value === '')
      .map(([field]) => field);

    if (missing.length > 0) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Vehicle information is incomplete',
        details: { missing },
      });
    }
  }
}
