import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Get,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { ComputeRouteDto } from '@/integrations/google-maps/dto/compute-route.dto';
import { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import { EvidenceAccessService } from '@/modules/support/evidence-access/evidence-access.service';
import { EstimateRouteDto } from './dto/estimate-route.dto';
import { OrderApproachService } from './order-approach.service';
import { OrderRouteService } from './order-route.service';
import { RoutesService } from './routes.service';

/** Each of these reaches the billed Routes API; see GoogleMapsController. */
const perMinute = (limit: number) =>
  Throttle({ default: { limit, ttl: 60_000 } });

const ORDER_ACCESS_DENIED = 'You cannot access this order';

@ApiTags('routes')
@ApiBearerAuth()
@Controller('routes')
export class RoutesController {
  constructor(
    private readonly service: RoutesService,
    private readonly orderRoutes: OrderRouteService,
    private readonly orderApproach: OrderApproachService,
    private readonly googleRoutes: GoogleRoutesService,
    private readonly access: EvidenceAccessService,
  ) {}

  @ApiOperation({
    summary: 'Estimate a route: road distance, duration and drawable polyline',
    description:
      'Uses the Google Routes API and falls back to a straight-line estimate when the provider is unreachable, so an order can always be placed. `distanceSource` reports which figure fed the price.',
  })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @perMinute(40)
  @Post('estimate')
  estimate(@Body() dto: EstimateRouteDto) {
    return this.service.estimate(dto);
  }

  @ApiOperation({
    summary: 'Compute a driving route (Google Routes API, server-side key)',
  })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @perMinute(30)
  @Post('compute')
  compute(@Body() dto: ComputeRouteDto) {
    return this.googleRoutes.computeRoute({
      origin: dto.origin,
      destination: dto.destination,
      intermediates: dto.intermediates,
    });
  }

  /**
   * Las dos rutas de una orden dibujan sus paradas (direcciones del cliente)
   * y, la de aproximacion, la ultima posicion del conductor. Filtraban solo
   * por orderId y las leia cualquier cliente o conductor. Misma regla que la
   * evidencia: staff, conductor con asignacion PENDING/ACCEPTED/COMPLETED,
   * cliente dueno. Se comprueba aqui y no en los servicios porque su cache es
   * por orden y compartida entre quienes la miran: un acierto de cache no
   * debe saltarse la comprobacion, y un id ajeno no debe gastar una llamada
   * facturada a Google.
   */
  @ApiOperation({
    summary: 'Get the cached driving route for an order (polyline + ETA)',
  })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @perMinute(60)
  @Get('orders/:orderId')
  async getOrderRoute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    await this.access.assertOrderAccess(user, orderId, {
      message: ORDER_ACCESS_DENIED,
    });
    return this.orderRoutes.getForOrder(orderId);
  }

  @ApiOperation({
    summary:
      "Leg from the driver's last known position to the stop they are heading to",
    description:
      'Complements the order route, which only covers pickup to dropoff. The origin comes from the stored driver location, so every viewer shares one cached answer. Recomputed only once the driver has moved more than 200 m, and `route` is null when there is no GPS fix yet.',
  })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @perMinute(60)
  @Get('orders/:orderId/approach')
  async getOrderApproach(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    await this.access.assertOrderAccess(user, orderId, {
      message: ORDER_ACCESS_DENIED,
    });
    return this.orderApproach.getForOrder(orderId);
  }
}
