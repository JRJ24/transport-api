import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { EstimateRouteDto } from './dto/estimate-route.dto';
import { RoutesService } from './routes.service';

@ApiTags('routes')
@ApiBearerAuth()
@Controller('routes')
export class RoutesController {
  constructor(private readonly service: RoutesService) {}

  @ApiOperation({ summary: 'Estimate route with internal/mock provider' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Post('estimate')
  estimate(@Body() dto: EstimateRouteDto) {
    return this.service.estimate(dto);
  }
}
