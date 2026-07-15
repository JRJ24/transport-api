import { Injectable } from '@nestjs/common';
import type { SystemParameter } from '@generated/prisma/client';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { UpsertParameterDto } from './dto/upsert-parameter.dto';

@Injectable()
export class ParametersService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<SystemParameter[]> {
    return this.prisma.systemParameter.findMany({ orderBy: { key: 'asc' } });
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
