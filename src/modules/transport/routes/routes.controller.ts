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
import { Roles } from '@/common/decorators/roles.decorator';
import { ComputeRouteDto } from '@/integrations/google-maps/dto/compute-route.dto';
import { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import { EstimateRouteDto } from './dto/estimate-route.dto';
import { OrderApproachService } from './order-approach.service';
import { OrderRouteService } from './order-route.service';
import { RoutesService } from './routes.service';

/** Each of these reaches the billed Routes API; see GoogleMapsController. */
const perMinute = (limit: number) =>
  Throttle({ default: { limit, ttl: 60_000 } });

@ApiTags('routes')
@ApiBearerAuth()
@Controller('routes')
export class RoutesController {
  constructor(
    private readonly service: RoutesService,
    private readonly orderRoutes: OrderRouteService,
    private readonly orderApproach: OrderApproachService,
    private readonly googleRoutes: GoogleRoutesService,
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

  @ApiOperation({
    summary: 'Get the cached driving route for an order (polyline + ETA)',
  })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @perMinute(60)
  @Get('orders/:orderId')
  getOrderRoute(@Param('orderId', ParseUUIDPipe) orderId: string) {
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
  getOrderApproach(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.orderApproach.getForOrder(orderId);
  }
}
