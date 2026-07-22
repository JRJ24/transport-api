import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CustomerAddress,
  CustomerProfile,
  Prisma,
} from '@generated/prisma/client';
import { TYPE_CUSTOMER } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';
import type { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import type { CreateCustomerProfileDto } from './dto/create-customer-profile.dto';
import type { CustomerQueryDto } from './dto/customer-query.dto';
import type { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import type { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

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
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: CustomerQueryDto): Promise<CustomerProfile[]> {
    const where: Prisma.CustomerProfileWhereInput = {
      ...(query.customerType && { customerType: query.customerType }),
      ...(query.status && { user: { is: { status: query.status } } }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { documentNumber: { contains: search, mode: 'insensitive' } },
        { billingEmail: { contains: search, mode: 'insensitive' } },
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
        {
          customerAddresses: {
            some: {
              OR: [
                { addressesLine: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
                { province: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    return this.prisma.customerProfile.findMany({
      where,
      include: {
        user: { select: SAFE_USER_SELECT },
        customerAddresses: true,
        transportOrders: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyProfile(userId: string): Promise<CustomerProfile> {
    return this.getProfileOrThrow(userId);
  }

  async createProfile(
    userId: string,
    dto: CreateCustomerProfileDto,
  ): Promise<CustomerProfile> {
    const existing = await this.prisma.customerProfile.findFirst({
      where: { userId },
    });

    if (existing) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Customer profile already exists for this user',
      });
    }

    this.assertBusinessHasCompanyName(dto.customerType, dto.companyName);

    return this.prisma.customerProfile.create({
      data: {
        userId,
        customerType: dto.customerType,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber.trim(),
        companyName: this.optionalString(dto.companyName),
        billingEmail: this.optionalEmail(dto.billingEmail),
        createdAt: new Date(),
      },
    });
  }

  async updateProfile(
    userId: string,
    dto: UpdateCustomerProfileDto,
  ): Promise<CustomerProfile> {
    const profile = await this.getProfileOrThrow(userId);
    const nextCustomerType = dto.customerType ?? profile.customerType;
    const nextCompanyName =
      dto.companyName !== undefined
        ? this.optionalString(dto.companyName)
        : profile.companyName;

    this.assertBusinessHasCompanyName(nextCustomerType, nextCompanyName);

    return this.prisma.customerProfile.update({
      where: { id: profile.id },
      data: {
        ...(dto.customerType !== undefined && {
          customerType: dto.customerType,
        }),
        ...(dto.documentType !== undefined && {
          documentType: dto.documentType,
        }),
        ...(dto.documentNumber !== undefined && {
          documentNumber: dto.documentNumber.trim(),
        }),
        ...(dto.companyName !== undefined && { companyName: nextCompanyName }),
        ...(dto.billingEmail !== undefined && {
          billingEmail: this.optionalEmail(dto.billingEmail),
        }),
      },
    });
  }

  async listAddresses(userId: string): Promise<CustomerAddress[]> {
    const profile = await this.getProfileOrThrow(userId);

    return this.prisma.customerAddress.findMany({
      where: { customerId: profile.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createAddress(
    userId: string,
    dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddress> {
    const profile = await this.getProfileOrThrow(userId);

    return this.prisma.$transaction(async (tx) => {
      const addressCount = await tx.customerAddress.count({
        where: { customerId: profile.id },
      });
      const shouldSetDefault = dto.isDefault ?? addressCount === 0;

      if (shouldSetDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId: profile.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.create({
        data: {
          customerId: profile.id,
          label: dto.label.trim(),
          addressesLine: dto.addressLine.trim(),
          city: dto.city.trim(),
          province: dto.province.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          isDefault: shouldSetDefault,
          createdAt: new Date(),
        },
      });
    });
  }

  async updateAddress(
    userId: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddress> {
    const profile = await this.getProfileOrThrow(userId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId: profile.id },
      });

      if (!existing) {
        throw new NotFoundException({
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: 'Customer address not found',
        });
      }

      if (dto.isDefault === true) {
        await tx.customerAddress.updateMany({
          where: { customerId: profile.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          ...(dto.label !== undefined && { label: dto.label.trim() }),
          ...(dto.addressLine !== undefined && {
            addressesLine: dto.addressLine.trim(),
          }),
          ...(dto.city !== undefined && { city: dto.city.trim() }),
          ...(dto.province !== undefined && {
            province: dto.province.trim(),
          }),
          ...(dto.latitude !== undefined && { latitude: dto.latitude }),
          ...(dto.longitude !== undefined && { longitude: dto.longitude }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        },
      });
    });
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    const profile = await this.getProfileOrThrow(userId);

    await this.prisma.$transaction(async (tx) => {
      const address = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId: profile.id },
      });

      if (!address) {
        throw new NotFoundException({
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: 'Customer address not found',
        });
      }

      await tx.customerAddress.delete({ where: { id: addressId } });

      if (!address.isDefault) {
        return;
      }

      const nextDefault = await tx.customerAddress.findFirst({
        where: { customerId: profile.id },
        orderBy: { createdAt: 'desc' },
      });

      if (nextDefault) {
        await tx.customerAddress.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    });
  }

  private async getProfileOrThrow(userId: string): Promise<CustomerProfile> {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    return profile;
  }

  private assertBusinessHasCompanyName(
    customerType: TYPE_CUSTOMER,
    companyName?: string | null,
  ): void {
    if (customerType !== TYPE_CUSTOMER.BUSINESS || companyName) {
      return;
    }

    throw new BadRequestException({
      code: ERROR_CODES.BAD_REQUEST,
      message: 'companyName is required for business customers',
    });
  }

  private optionalString(value?: string | null): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : null;
  }

  private optionalEmail(value?: string | null): string | null {
    const trimmed = this.optionalString(value);

    return trimmed ? trimmed.toLowerCase() : null;
  }
}
