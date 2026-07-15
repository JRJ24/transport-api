import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OrderAssignment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { DispatchOrderDto } from './dto/dispatch-order.dto';
import { DispatchService } from './dispatch.service';

@ApiTags('dispatch')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERATOR)
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly service: DispatchService) {}

  @ApiOperation({ summary: 'List pending orders for dispatch' })
  @Get('pending-orders')
  pendingOrders() {
    return this.service.pendingOrders();
  }

  @ApiOperation({ summary: 'List available drivers for dispatch' })
  @Get('available-drivers')
  availableDrivers() {
    return this.service.availableDrivers();
  }

  @ApiOperation({ summary: 'Dispatch an order to a driver and vehicle' })
  @Post()
  dispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DispatchOrderDto,
  ): Promise<OrderAssignment> {
    return this.service.dispatch(user, dto);
  }
}
