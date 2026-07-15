import { Injectable } from '@nestjs/common';
import type { VehicleCategory } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { CreateVehicleCategoryDto } from './dto/create-vehicle-category.dto';
import type { UpdateVehicleCategoryDto } from './dto/update-vehicle-category.dto';

@Injectable()
export class VehicleCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(includeInactive = false): Promise<VehicleCategory[]> {
    return this.prisma.vehicleCategory.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  findOne(id: string): Promise<VehicleCategory | null> {
    return this.prisma.vehicleCategory.findUnique({ where: { id } });
  }

  create(dto: CreateVehicleCategoryDto): Promise<VehicleCategory> {
    return this.prisma.vehicleCategory.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description.trim(),
        maxWeightKg: dto.maxWeightKg,
        maxVolumenM3: dto.maxVolumenM3,
        baseCapacityNote: dto.baseCapacityNote.trim(),
        isActive: dto.isActive ?? true,
      },
    });
  }

  update(id: string, dto: UpdateVehicleCategoryDto): Promise<VehicleCategory> {
    return this.prisma.vehicleCategory.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && {
          code: dto.code.trim().toUpperCase(),
        }),
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && {
          description: dto.description.trim(),
        }),
        ...(dto.maxWeightKg !== undefined && {
          maxWeightKg: dto.maxWeightKg,
        }),
        ...(dto.maxVolumenM3 !== undefined && {
          maxVolumenM3: dto.maxVolumenM3,
        }),
        ...(dto.baseCapacityNote !== undefined && {
          baseCapacityNote: dto.baseCapacityNote.trim(),
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  deactivate(id: string): Promise<VehicleCategory> {
    return this.prisma.vehicleCategory.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
