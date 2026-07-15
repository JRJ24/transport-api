import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { EtaService } from './eta.service';

@ApiTags('eta')
@ApiBearerAuth()
@Controller('eta')
export class EtaController {
  constructor(private readonly service: EtaService) {}

  @ApiOperation({ summary: 'Get internal/mock ETA for an order' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId')
  forOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.service.forOrder(orderId);
  }
}
