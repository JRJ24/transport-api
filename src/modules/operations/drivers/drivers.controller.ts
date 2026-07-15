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
import type { DriverProfile } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';
import { UpdateDriverVerificationDto } from './dto/update-driver-verification.dto';
import { DriversService } from './drivers.service';

@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(private readonly service: DriversService) {}

  @ApiOperation({ summary: 'List drivers' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get()
  list(): Promise<DriverProfile[]> {
    return this.service.list();
  }

  @ApiOperation({ summary: 'Get my driver profile' })
  @Roles(ROLES.DRIVER)
  @Get('me')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DriverProfile | null> {
    return this.service.findMine(user.id);
  }

  @ApiOperation({ summary: 'Create a driver profile' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(@Body() dto: CreateDriverDto): Promise<DriverProfile> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Get a driver profile' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DriverProfile | null> {
    return this.service.findOne(id);
  }

  @ApiOperation({ summary: 'Update driver availability' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.DRIVER)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverStatusDto,
  ): Promise<DriverProfile> {
    return this.service.updateStatus(id, dto);
  }

  @ApiOperation({ summary: 'Update driver verification status' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/verification')
  updateVerification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverVerificationDto,
  ): Promise<DriverProfile> {
    return this.service.updateVerification(id, dto);
  }
}
