import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DeviceToken } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { AllowUnverifiedDriver } from '@/common/decorators/allow-unverified-driver.decorator';
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
  // Como /auth/me y /drivers/me: es autoservicio sobre el propio dispositivo,
  // no operacion. El conductor pendiente registra su token al iniciar sesion
  // (la app no lo reintenta al ser aprobado) y debe poder borrarlo al cerrar
  // sesion; con 403 el token quedaba activo y este telefono recibiria sus
  // push aunque entre otra cuenta.
  @AllowUnverifiedDriver()
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post()
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceToken> {
    return this.service.register(user.id, dto);
  }

  @ApiOperation({ summary: 'List my active devices' })
  @AllowUnverifiedDriver()
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser): Promise<DeviceToken[]> {
    return this.service.listActive(user.id);
  }

  @ApiOperation({ summary: 'Deactivate a device push token (logout)' })
  @AllowUnverifiedDriver()
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Delete(':token')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ): Promise<{ count: number }> {
    return this.service.deactivate(user.id, token);
  }
}
