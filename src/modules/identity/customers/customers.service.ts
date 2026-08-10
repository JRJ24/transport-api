import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { ConfigType } from '@nestjs/config';
import type {
  CustomerAddress,
  CustomerCreditAccount,
  CustomerProfile,
  Prisma,
} from '@generated/prisma/client';
import {
  CREDIT_ACCOUNT_STATUS,
  ROLES,
  STATUS_ACCOUNT,
  TYPE_CUSTOMER,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { hashPassword } from '@/common/utils/hash.util';
import { authConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import type { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import type { CreateCustomerProfileDto } from './dto/create-customer-profile.dto';
import type { CreateTmsCustomerDto } from './dto/create-tms-customer.dto';
import type { CustomerQueryDto } from './dto/customer-query.dto';
import type { RequestCustomerCreditDto } from './dto/request-customer-credit.dto';
import type { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
import type { UpdateCustomerCreditDto } from './dto/update-customer-credit.dto';
import type { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import type { UpdateTmsCustomerDto } from './dto/update-tms-customer.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
  ) {}

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
        creditAccount: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyProfile(
    userId: string,
  ): Promise<
    CustomerProfile & { creditAccount: CustomerCreditAccount | null }
  > {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId },
      include: { creditAccount: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    return profile;
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

  async createFromTms(
    actorUserId: string,
    dto: CreateTmsCustomerDto,
  ): Promise<unknown> {
    this.assertBusinessHasCompanyName(dto.customerType, dto.companyName);

    const email = dto.email.toLowerCase().trim();
    const phone = dto.phone.trim();
    const documentNumber = dto.documentNumber.trim();

    const [existingUser, existingDocument] = await Promise.all([
      this.prisma.user.findFirst({
        where: { OR: [{ email }, { phone }] },
        select: { id: true, email: true, phone: true },
      }),
      this.prisma.customerProfile.findFirst({
        where: { documentNumber },
        select: { id: true },
      }),
    ]);

    if (existingUser) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'A user with this email or phone already exists',
      });
    }

    if (existingDocument) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'A customer with this document already exists',
      });
    }

    const passwordHash = await hashPassword(
      randomBytes(24).toString('base64url'),
      this.auth.bcryptSaltRounds,
    );

    return this.prisma.$transaction(async (tx) => {
      const customerUser = await tx.user.create({
        data: {
          fullName: dto.fullName.trim(),
          email,
          phone,
          passwordHash,
          userRoles: {
            create: {
              rol: { connect: { code: ROLES.CUSTOMER } },
            },
          },
        },
        select: SAFE_USER_SELECT,
      });

      const profile = await tx.customerProfile.create({
        data: {
          userId: customerUser.id,
          customerType: dto.customerType,
          documentType: dto.documentType,
          documentNumber,
          companyName: this.optionalString(dto.companyName),
          billingEmail: this.optionalEmail(dto.billingEmail),
          createdAt: new Date(),
        },
        include: {
          user: { select: SAFE_USER_SELECT },
          customerAddresses: true,
          transportOrders: { select: { id: true, status: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CUSTOMER_CREATED_FAST',
          entityType: 'CUSTOMER',
          entityId: profile.id,
          newValues: {
            customerId: profile.id,
            userId: customerUser.id,
            source: 'transport-portal',
          },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return profile;
    });
  }

  async updateFromTms(
    actorUserId: string,
    id: string,
    dto: UpdateTmsCustomerDto,
  ): Promise<unknown> {
    const existing = await this.prisma.customerProfile.findUnique({
      where: { id },
      include: { user: { select: SAFE_USER_SELECT } },
    });

    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    const nextCustomerType = dto.customerType ?? existing.customerType;
    const nextCompanyName =
      dto.companyName !== undefined
        ? this.optionalString(dto.companyName)
        : existing.companyName;
    this.assertBusinessHasCompanyName(nextCustomerType, nextCompanyName);

    return this.prisma.$transaction(async (tx) => {
      if (
        dto.fullName !== undefined ||
        dto.email !== undefined ||
        dto.phone !== undefined
      ) {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            ...(dto.fullName !== undefined && {
              fullName: dto.fullName.trim(),
            }),
            ...(dto.email !== undefined && {
              email: dto.email.toLowerCase().trim(),
            }),
            ...(dto.phone !== undefined && { phone: dto.phone.trim() }),
          },
        });
      }

      const profile = await tx.customerProfile.update({
        where: { id },
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
          ...(dto.companyName !== undefined && {
            companyName: nextCompanyName,
          }),
          ...(dto.billingEmail !== undefined && {
            billingEmail: this.optionalEmail(dto.billingEmail),
          }),
        },
        include: {
          user: { select: SAFE_USER_SELECT },
          customerAddresses: true,
          transportOrders: { select: { id: true, status: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CUSTOMER_UPDATED_TMS',
          entityType: 'CUSTOMER',
          entityId: id,
          oldValues: {
            customerType: existing.customerType,
            documentType: existing.documentType,
            documentNumber: existing.documentNumber,
            companyName: existing.companyName,
            billingEmail: existing.billingEmail,
            user: {
              id: existing.user.id,
              fullName: existing.user.fullName,
              email: existing.user.email,
              phone: existing.user.phone,
              status: existing.user.status,
            },
          },
          newValues: {
            customerType: profile.customerType,
            documentType: profile.documentType,
            documentNumber: profile.documentNumber,
            companyName: profile.companyName,
            billingEmail: profile.billingEmail,
            user: {
              id: profile.user.id,
              fullName: profile.user.fullName,
              email: profile.user.email,
              phone: profile.user.phone,
              status: profile.user.status,
            },
          },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return profile;
    });
  }

  async deactivateFromTms(actorUserId: string, id: string): Promise<unknown> {
    const existing = await this.prisma.customerProfile.findUnique({
      where: { id },
      include: { user: { select: SAFE_USER_SELECT } },
    });

    if (!existing) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.userId },
        data: { status: STATUS_ACCOUNT.INACTIVE },
      });
      const profile = await tx.customerProfile.findUniqueOrThrow({
        where: { id },
        include: {
          user: { select: SAFE_USER_SELECT },
          customerAddresses: true,
          transportOrders: { select: { id: true, status: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CUSTOMER_SOFT_DELETED',
          entityType: 'CUSTOMER',
          entityId: id,
          oldValues: { userStatus: existing.user.status },
          newValues: { userStatus: STATUS_ACCOUNT.INACTIVE },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return profile;
    });
  }

  async upsertCreditAccount(
    actorUserId: string,
    id: string,
    dto: UpdateCustomerCreditDto,
  ): Promise<CustomerCreditAccount> {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id },
      select: { id: true, customerType: true },
    });

    if (!customer) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    if (customer.customerType !== TYPE_CUSTOMER.BUSINESS) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Corporate credit is only available for business customers',
      });
    }

    const status = dto.status ?? CREDIT_ACCOUNT_STATUS.ACTIVE;
    const approvedData =
      status === CREDIT_ACCOUNT_STATUS.ACTIVE
        ? { approvedBy: actorUserId, approvedAt: new Date() }
        : { approvedBy: null, approvedAt: null };

    const account = await this.prisma.customerCreditAccount.upsert({
      where: { customerId: id },
      update: {
        creditLimit: dto.creditLimit,
        creditDays: dto.creditDays ?? undefined,
        status,
        notes: this.optionalString(dto.notes),
        ...approvedData,
      },
      create: {
        customerId: id,
        creditLimit: dto.creditLimit,
        creditDays: dto.creditDays ?? 15,
        balanceUsed: 0,
        status,
        notes: this.optionalString(dto.notes),
        ...approvedData,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'CUSTOMER_CREDIT_UPDATED',
        entityType: 'CUSTOMER',
        entityId: id,
        newValues: {
          creditLimit: dto.creditLimit,
          creditDays: account.creditDays,
          status: account.status,
        },
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      },
    });

    return account;
  }

  async requestCreditAccount(
    userId: string,
    dto: RequestCustomerCreditDto,
  ): Promise<CustomerCreditAccount> {
    const profile = await this.prisma.customerProfile.findFirst({
      where: { userId },
      include: { creditAccount: true },
    });

    if (!profile) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    if (profile.customerType !== TYPE_CUSTOMER.BUSINESS) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Corporate credit is only available for business customers',
      });
    }

    if (profile.creditAccount?.status === CREDIT_ACCOUNT_STATUS.ACTIVE) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Customer already has active corporate credit',
      });
    }

    if (profile.creditAccount?.status === CREDIT_ACCOUNT_STATUS.BLOCKED) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Corporate credit account is blocked',
      });
    }

    const creditDays =
      dto.creditDays ?? profile.creditAccount?.creditDays ?? 15;
    const account = await this.prisma.customerCreditAccount.upsert({
      where: { customerId: profile.id },
      update: {
        creditLimit: dto.requestedLimit,
        creditDays,
        status: CREDIT_ACCOUNT_STATUS.PENDING,
        approvedBy: null,
        approvedAt: null,
        notes: this.optionalString(dto.notes),
      },
      create: {
        customerId: profile.id,
        creditLimit: dto.requestedLimit,
        creditDays,
        balanceUsed: 0,
        status: CREDIT_ACCOUNT_STATUS.PENDING,
        notes: this.optionalString(dto.notes),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'CUSTOMER_CREDIT_REQUESTED',
        entityType: 'CUSTOMER',
        entityId: profile.id,
        newValues: {
          requestedLimit: dto.requestedLimit,
          creditDays,
          status: account.status,
        },
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      },
    });

    return account;
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
          countryCode: this.optionalString(dto.countryCode),
          postalCode: this.optionalString(dto.postalCode),
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
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
          ...(dto.countryCode !== undefined && {
            countryCode: this.optionalString(dto.countryCode),
          }),
          ...(dto.postalCode !== undefined && {
            postalCode: this.optionalString(dto.postalCode),
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
