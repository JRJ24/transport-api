import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { ROLES, STATUS_ACCOUNT } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { hashPassword } from '@/common/utils/hash.util';
import {
  resolvePageParams,
  toPaginatedResult,
} from '@/common/utils/pagination.util';
import type { PaginatedResult } from '@/common/interfaces/pagination.interface';
import { authConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import type { UserQueryDto } from './dto/user-query.dto';
import {
  toUserResponse,
  type UserResponse,
  type UserWithRoles,
} from './presenters/user.presenter';

const USER_WITH_ROLES_INCLUDE = {
  userRoles: { include: { rol: true } },
} as const;

export interface CreateUserInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  roles: ROLES[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  findByEmailWithRoles(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: USER_WITH_ROLES_INCLUDE,
    });
  }

  findByIdWithRoles(id: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: USER_WITH_ROLES_INCLUDE,
    });
  }

  async getByIdWithRoles(id: string): Promise<UserWithRoles> {
    const user = await this.findByIdWithRoles(id);

    if (!user) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'User not found',
      });
    }

    return user;
  }

  async create(input: CreateUserInput): Promise<UserWithRoles> {
    const passwordHash = await hashPassword(
      input.password,
      this.auth.bcryptSaltRounds,
    );

    return this.prisma.user.create({
      data: {
        fullName: input.fullName.trim(),
        email: input.email.toLowerCase().trim(),
        phone: input.phone.trim(),
        passwordHash,
        userRoles: {
          create: input.roles.map((code) => ({
            rol: { connect: { code } },
          })),
        },
      },
      include: USER_WITH_ROLES_INCLUDE,
    });
  }

  async updateProfile(
    id: string,
    data: { fullName?: string; phone?: string },
  ): Promise<UserWithRoles> {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined && { fullName: data.fullName.trim() }),
        ...(data.phone !== undefined && { phone: data.phone.trim() }),
      },
      include: USER_WITH_ROLES_INCLUDE,
    });
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async findAll(query: UserQueryDto): Promise<PaginatedResult<UserResponse>> {
    const params = resolvePageParams(query);

    const where = {
      ...(query.status && { status: query.status }),
      ...(query.search && {
        OR: [
          {
            fullName: {
              contains: query.search,
              mode: 'insensitive' as const,
            },
          },
          { email: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [users, totalItems] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: USER_WITH_ROLES_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return toPaginatedResult(users.map(toUserResponse), totalItems, params);
  }

  async setStatus(id: string, status: STATUS_ACCOUNT): Promise<UserWithRoles> {
    return this.prisma.user.update({
      where: { id },
      data: { status },
      include: USER_WITH_ROLES_INCLUDE,
    });
  }
}
