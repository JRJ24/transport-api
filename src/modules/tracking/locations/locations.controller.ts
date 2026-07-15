import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DriverLocation } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreateLocationDto } from './dto/create-location.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly service: LocationsService) {}

  @ApiOperation({ summary: 'Record driver location' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(@Body() dto: CreateLocationDto): Promise<DriverLocation> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'List recent locations for an order' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId')
  listByOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<DriverLocation[]> {
    return this.service.listByOrder(orderId);
  }

  @ApiOperation({ summary: 'Get latest location for an order' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId/latest')
  latestByOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<DriverLocation | null> {
    return this.service.latestByOrder(orderId);
  }
}
