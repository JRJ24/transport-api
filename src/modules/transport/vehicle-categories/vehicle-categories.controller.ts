import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { VehicleCategory } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreateVehicleCategoryDto } from './dto/create-vehicle-category.dto';
import { UpdateVehicleCategoryDto } from './dto/update-vehicle-category.dto';
import { VehicleCategoriesService } from './vehicle-categories.service';

@ApiTags('vehicle-categories')
@Controller('vehicle-categories')
export class VehicleCategoriesController {
  constructor(private readonly service: VehicleCategoriesService) {}

  @ApiOperation({ summary: 'List active vehicle categories' })
  @Public()
  @Get()
  findAll(
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive = false,
  ): Promise<VehicleCategory[]> {
    return this.service.findAll(includeInactive);
  }

  @ApiOperation({ summary: 'Get a vehicle category' })
  @Public()
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VehicleCategory | null> {
    return this.service.findOne(id);
  }

  @ApiOperation({ summary: 'Create a vehicle category' })
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(@Body() dto: CreateVehicleCategoryDto): Promise<VehicleCategory> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Update a vehicle category' })
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleCategoryDto,
  ): Promise<VehicleCategory> {
    return this.service.update(id, dto);
  }

  @ApiOperation({ summary: 'Deactivate a vehicle category' })
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Delete(':id')
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<VehicleCategory> {
    return this.service.deactivate(id);
  }
}
