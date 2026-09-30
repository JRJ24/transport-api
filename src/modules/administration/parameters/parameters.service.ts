import { Injectable } from '@nestjs/common';
import type { Prisma, SystemParameter } from '@generated/prisma/client';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { ParameterQueryDto } from './dto/parameter-query.dto';
import type { UpsertParameterDto } from './dto/upsert-parameter.dto';

@Injectable()
export class ParametersService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ParameterQueryDto): Promise<SystemParameter[]> {
    const where: Prisma.SystemParameterWhereInput = {
      ...(query.valueType && { valueType: query.valueType }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { value: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.systemParameter.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { key: 'asc' },
    });
  }

  async upsert(
    user: AuthenticatedUser,
    dto: UpsertParameterDto,
  ): Promise<SystemParameter> {
    const key = dto.key.trim();
    const previous = await this.prisma.systemParameter.findUnique({
      where: { key },
      select: { value: true },
    });
    const saved = await this.prisma.systemParameter.upsert({
      where: { key: dto.key.trim() },
      update: {
        value: dto.value,
        valueType: dto.valueType,
        description: dto.description.trim(),
        updatedBy: user.id,
      },
      create: {
        key: dto.key.trim(),
        value: dto.value,
        valueType: dto.valueType,
        description: dto.description.trim(),
        updatedBy: user.id,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'SYSTEM_PARAMETER_UPDATED',
        entityType: 'SYSTEM_PARAMETER',
        entityId: key,
        oldValues: previous ? { key, value: previous.value } : undefined,
        newValues: { key, value: dto.value },
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      },
    });
    return saved;
  }
}
