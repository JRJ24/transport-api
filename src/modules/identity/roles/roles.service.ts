import { Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@generated/prisma/client';
import type { ROLES } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Role[]> {
    return this.prisma.role.findMany({ orderBy: { code: 'asc' } });
  }

  async getByCode(code: ROLES): Promise<Role> {
    const role = await this.prisma.role.findUnique({ where: { code } });

    if (!role) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: `Role ${code} not found. Did you run the database seed?`,
      });
    }

    return role;
  }

  async assign(userId: string, code: ROLES): Promise<void> {
    const role = await this.getByCode(code);

    const existing = await this.prisma.userRole.findFirst({
      where: { userID: userId, roleID: role.id },
    });

    if (existing) {
      return;
    }

    await this.prisma.userRole.create({
      data: { userID: userId, roleID: role.id },
    });
  }

  async revoke(userId: string, code: ROLES): Promise<void> {
    const role = await this.getByCode(code);

    await this.prisma.userRole.deleteMany({
      where: { userID: userId, roleID: role.id },
    });
  }
}
