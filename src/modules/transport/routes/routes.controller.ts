import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Get,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { ComputeRouteDto } from '@/integrations/google-maps/dto/compute-route.dto';
import { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import { EstimateRouteDto } from './dto/estimate-route.dto';
import { OrderRouteService } from './order-route.service';
import { RoutesService } from './routes.service';

@ApiTags('routes')
@ApiBearerAuth()
@Controller('routes')
export class RoutesController {
  constructor(
    private readonly service: RoutesService,
    private readonly orderRoutes: OrderRouteService,
    private readonly googleRoutes: GoogleRoutesService,
  ) {}

  @ApiOperation({
    summary: 'Estimate route with internal/mock provider (pricing)',
  })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Post('estimate')
  estimate(@Body() dto: EstimateRouteDto) {
    return this.service.estimate(dto);
  }

  @ApiOperation({
    summary: 'Compute a driving route (Google Routes API, server-side key)',
  })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
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
  @Get('orders/:orderId')
  getOrderRoute(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.orderRoutes.getForOrder(orderId);
  }
}
