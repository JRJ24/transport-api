import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { DriverProfile, Vehicle } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { AllowUnverifiedDriver } from '@/common/decorators/allow-unverified-driver.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CreateDriverDto } from './dto/create-driver.dto';
import { DriverQueryDto } from './dto/driver-query.dto';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
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
  list(@Query() query: DriverQueryDto): Promise<DriverProfile[]> {
    return this.service.list(query);
  }

  @ApiOperation({ summary: 'Get my driver profile' })
  @AllowUnverifiedDriver()
  @Roles(ROLES.DRIVER)
  @Get('me')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DriverProfile | null> {
    return this.service.findMine(user.id);
  }

  @ApiOperation({ summary: 'List vehicles owned by the authenticated driver' })
  @Roles(ROLES.DRIVER)
  @Get('me/vehicles')
  findMyVehicles(@CurrentUser() user: AuthenticatedUser): Promise<Vehicle[]> {
    return this.service.findMyVehicles(user.id);
  }

  @ApiOperation({ summary: 'Register a new driver for portal approval' })
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('onboarding/register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDriverDto): Promise<DriverProfile> {
    return this.service.register(dto);
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

  @ApiOperation({ summary: 'Update a driver profile' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverDto,
  ): Promise<DriverProfile> {
    return this.service.update(id, dto, user.id);
  }

  @ApiOperation({ summary: 'Update driver availability' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.DRIVER)
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDriverStatusDto,
  ): Promise<DriverProfile> {
    return this.service.updateStatus(user, id, dto);
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

  @ApiOperation({ summary: 'Soft delete a driver by suspending access' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Delete(':id')
  softDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DriverProfile> {
    return this.service.softDelete(id, user.id);
  }
}
