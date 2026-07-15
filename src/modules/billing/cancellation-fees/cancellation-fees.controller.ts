import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { CancellationFeesService } from './cancellation-fees.service';

@ApiTags('cancellation-fees')
@ApiBearerAuth()
@Controller('cancellation-fees')
export class CancellationFeesController {
  constructor(private readonly service: CancellationFeesService) {}

  @ApiOperation({ summary: 'Calculate internal/mock cancellation fee' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Get('orders/:orderId')
  calculate(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.service.calculate(orderId);
  }
}
