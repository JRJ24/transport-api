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

    // INSERT … ON CONFLICT DO NOTHING on the (user, role) unique index: a
    // double click or two admins at once leave a single assignment.
    await this.prisma.userRole.createMany({
      data: [{ userID: userId, roleID: role.id }],
      skipDuplicates: true,
    });
  }

  async revoke(userId: string, code: ROLES): Promise<void> {
    const role = await this.getByCode(code);

    await this.prisma.userRole.deleteMany({
      where: { userID: userId, roleID: role.id },
    });
  }
}
