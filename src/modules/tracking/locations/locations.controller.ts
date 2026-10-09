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
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { EvidenceAccessService } from '@/modules/support/evidence-access/evidence-access.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { LocationsService } from './locations.service';

/**
 * Las lecturas filtraban solo por orderId: cualquier cliente (se registran
 * solos) o conductor veia el GPS en vivo de una orden ajena con solo tener
 * el id. Ahora pasan por la misma regla que la evidencia: staff sin
 * restriccion, conductor con asignacion PENDING/ACCEPTED/COMPLETED, cliente
 * dueno de la orden. Mismo 403 exista o no la orden, y antes de consultar
 * nada.
 */
const ORDER_ACCESS_DENIED = 'You cannot access this order';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly service: LocationsService,
    private readonly access: EvidenceAccessService,
  ) {}

  // Escritura: LocationsService ya exige que el conductor publique con su
  // propio perfil y con asignacion ACCEPTED en la orden.
  @ApiOperation({ summary: 'Record driver location' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLocationDto,
  ): Promise<DriverLocation> {
    return this.service.create(user, dto);
  }

  @ApiOperation({ summary: 'List recent locations for an order' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId')
  async listByOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<DriverLocation[]> {
    await this.access.assertOrderAccess(user, orderId, {
      message: ORDER_ACCESS_DENIED,
    });
    return this.service.listByOrder(orderId);
  }

  @ApiOperation({ summary: 'Get latest location for an order' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId/latest')
  async latestByOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<DriverLocation | null> {
    await this.access.assertOrderAccess(user, orderId, {
      message: ORDER_ACCESS_DENIED,
    });
    return this.service.latestByOrder(orderId);
  }
}
