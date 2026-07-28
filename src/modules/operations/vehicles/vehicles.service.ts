import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  Vehicle,
  VehicleDocument,
} from '@generated/prisma/client';
import { STATUS_VEHICLE } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import type { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import type { CreateVehicleDto } from './dto/create-vehicle.dto';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto';
import type { VehicleQueryDto } from './dto/vehicle-query.dto';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: VehicleQueryDto): Promise<Vehicle[]> {
    const where: Prisma.VehicleWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.driverId && { driverId: query.driverId }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { plateNumber: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { color: { contains: search, mode: 'insensitive' } },
        {
          vehicleCategory: {
            is: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    return this.prisma.vehicle.findMany({
      where,
      include: {
        vehicleCategory: true,
        vehiclesDocuments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string): Promise<Vehicle | null> {
    return this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        vehicleCategory: true,
        vehiclesDocuments: true,
      },
    });
  }

  create(dto: CreateVehicleDto): Promise<Vehicle> {
    return this.prisma.vehicle.create({
      data: {
        driverId: dto.driverId,
        categoryId: dto.categoryId,
        plateNumber: dto.plateNumber.trim().toUpperCase(),
        brand: dto.brand.trim(),
        model: dto.model.trim(),
        year: dto.year,
        color: dto.color.trim(),
        status: dto.status ?? STATUS_VEHICLE.ACTIVE,
        createdAt: new Date(),
      },
    });
  }

  update(id: string, dto: UpdateVehicleDto): Promise<Vehicle> {
    return this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(dto.driverId !== undefined && { driverId: dto.driverId }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.plateNumber !== undefined && {
          plateNumber: dto.plateNumber.trim().toUpperCase(),
        }),
        ...(dto.brand !== undefined && { brand: dto.brand.trim() }),
        ...(dto.model !== undefined && { model: dto.model.trim() }),
        ...(dto.year !== undefined && { year: dto.year }),
        ...(dto.color !== undefined && { color: dto.color.trim() }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async softDelete(id: string, actorUserId: string): Promise<Vehicle> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.vehicle.findUnique({ where: { id } });
      const updated = await tx.vehicle.update({
        where: { id },
        data: { status: STATUS_VEHICLE.INACTIVE },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'VEHICLE_SOFT_DELETED',
          entityType: 'VEHICLE',
          entityId: id,
          ...(existing && {
            oldValues: {
              status: existing.status,
              plateNumber: existing.plateNumber,
            },
          }),
          newValues: { status: updated.status, plateNumber: updated.plateNumber },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return updated;
    });
  }

  listDocuments(vehicleId: string): Promise<VehicleDocument[]> {
    return this.prisma.vehicleDocument.findMany({
      where: { vehicleId },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  addDocument(
    vehicleId: string,
    dto: CreateVehicleDocumentDto,
  ): Promise<VehicleDocument> {
    return this.prisma.vehicleDocument.create({
      data: {
        vehicleId,
        documentType: dto.documentType,
        fileUrl: dto.fileUrl.trim(),
        expirationDate: dto.expirationDate,
        status: dto.status,
      },
    });
  }
}
