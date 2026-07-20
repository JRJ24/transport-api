import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DeviceToken } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { DeviceTokensService } from './device-tokens.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly service: DeviceTokensService) {}

  @ApiOperation({ summary: 'Register / refresh this device push token' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post()
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceToken> {
    return this.service.register(user.id, dto);
  }

  @ApiOperation({ summary: 'List my active devices' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser): Promise<DeviceToken[]> {
    return this.service.listActive(user.id);
  }

  @ApiOperation({ summary: 'Deactivate a device push token (logout)' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Delete(':token')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ): Promise<{ count: number }> {
    return this.service.deactivate(user.id, token);
  }
}
