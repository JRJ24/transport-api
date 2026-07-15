import { Injectable } from '@nestjs/common';
import type { Vehicle, VehicleDocument } from '@generated/prisma/client';
import { STATUS_VEHICLE } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import type { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import type { CreateVehicleDto } from './dto/create-vehicle.dto';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Vehicle[]> {
    return this.prisma.vehicle.findMany({
      include: { vehicleCategory: true, vehiclesDocuments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string): Promise<Vehicle | null> {
    return this.prisma.vehicle.findUnique({
      where: { id },
      include: { vehicleCategory: true, vehiclesDocuments: true },
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
