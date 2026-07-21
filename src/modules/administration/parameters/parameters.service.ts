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

  upsert(
    user: AuthenticatedUser,
    dto: UpsertParameterDto,
  ): Promise<SystemParameter> {
    return this.prisma.systemParameter.upsert({
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
  }
}
