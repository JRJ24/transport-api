import { Injectable } from '@nestjs/common';
import type { Catalog, Municipality, Prisma, Province } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { CatalogQueryDto } from './dto/catalog-query.dto';
import type { CreateCatalogDto } from './dto/create-catalog.dto';
import type { UpdateCatalogDto } from './dto/update-catalog.dto';

@Injectable()
export class CatalogsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: CatalogQueryDto): Promise<Catalog[]> {
    const where: Prisma.CatalogWhereInput = {
      ...(query.groupKey && { groupKey: query.groupKey }),
      ...(query.isActive !== undefined && {
        isActive: query.isActive === 'true',
      }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { label: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.catalog.findMany({
      where,
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

  listProvinces(): Promise<Province[]> {
    return this.prisma.province.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  listMunicipalities(provinceId: string): Promise<Municipality[]> {
    return this.prisma.municipality.findMany({
      where: { provinceId, isActive: true, province: { isActive: true } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }
}
