import { Injectable } from '@nestjs/common';
import type { Catalog } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { CreateCatalogDto } from './dto/create-catalog.dto';
import type { UpdateCatalogDto } from './dto/update-catalog.dto';

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  list(groupKey?: string): Promise<Catalog[]> {
    return this.prisma.catalog.findMany({
      where: { ...(groupKey && { groupKey }) },
      orderBy: [{ groupKey: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  create(dto: CreateCatalogDto): Promise<Catalog> {
    return this.prisma.catalog.create({
      data: {
        groupKey: dto.groupKey.trim(),
        code: dto.code.trim().toUpperCase(),
        label: dto.label.trim(),
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  update(id: string, dto: UpdateCatalogDto): Promise<Catalog> {
    return this.prisma.catalog.update({
      where: { id },
      data: {
        ...(dto.groupKey !== undefined && { groupKey: dto.groupKey.trim() }),
        ...(dto.code !== undefined && {
          code: dto.code.trim().toUpperCase(),
        }),
        ...(dto.label !== undefined && { label: dto.label.trim() }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }
}
