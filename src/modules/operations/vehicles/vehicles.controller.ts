import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Vehicle, VehicleDocument } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreateVehicleDocumentDto } from './dto/create-vehicle-document.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehiclesService } from './vehicles.service';

@ApiTags('vehicles')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERATOR)
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly service: VehiclesService) {}

  @ApiOperation({ summary: 'List vehicles' })
  @Get()
  list(): Promise<Vehicle[]> {
    return this.service.list();
  }

  @ApiOperation({ summary: 'Create a vehicle' })
  @Post()
  create(@Body() dto: CreateVehicleDto): Promise<Vehicle> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Get a vehicle' })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Vehicle | null> {
    return this.service.findOne(id);
  }

  @ApiOperation({ summary: 'Update a vehicle' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    return this.service.update(id, dto);
  }

  @ApiOperation({ summary: 'List vehicle documents' })
  @Get(':id/documents')
  listDocuments(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VehicleDocument[]> {
    return this.service.listDocuments(id);
  }

  @ApiOperation({ summary: 'Add a vehicle document' })
  @Post(':id/documents')
  addDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVehicleDocumentDto,
  ): Promise<VehicleDocument> {
    return this.service.addDocument(id, dto);
  }
}
