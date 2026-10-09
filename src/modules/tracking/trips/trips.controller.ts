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
import type { TrackingSession } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { EvidenceAccessService } from '@/modules/support/evidence-access/evidence-access.service';
import { StartTripDto } from './dto/start-trip.dto';
import { TripsService } from './trips.service';

/**
 * El listado de viajes de una orden (inicio, fin, ultima ubicacion) filtraba
 * solo por orderId y lo leia cualquier cliente o conductor. Misma regla que
 * la evidencia: staff, conductor con asignacion PENDING/ACCEPTED/COMPLETED o
 * cliente dueno; 403 igual exista o no la orden.
 */
const ORDER_ACCESS_DENIED = 'You cannot access this order';

@ApiTags('trips')
@ApiBearerAuth()
@Controller('trips')
export class TripsController {
  constructor(
    private readonly service: TripsService,
    private readonly access: EvidenceAccessService,
  ) {}

  // start/end: TripsService ya exige perfil propio y asignacion ACCEPTED.
  @ApiOperation({ summary: 'Start a tracking trip' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post('start')
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartTripDto,
  ): Promise<TrackingSession> {
    return this.service.start(user, dto);
  }

  @ApiOperation({ summary: 'End a tracking trip' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/end')
  end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TrackingSession> {
    return this.service.end(user, id);
  }

  @ApiOperation({ summary: 'List tracking trips by order' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId')
  async listByOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<TrackingSession[]> {
    await this.access.assertOrderAccess(user, orderId, {
      message: ORDER_ACCESS_DENIED,
    });
    return this.service.listByOrder(orderId);
  }
}
