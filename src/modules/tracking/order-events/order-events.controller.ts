import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OrderEvent } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CreateOrderEventDto } from './dto/create-order-event.dto';
import { OrderEventsService } from './order-events.service';

@ApiTags('order-events')
@ApiBearerAuth()
@Controller('order-events')
export class OrderEventsController {
  constructor(private readonly service: OrderEventsService) {}

  @ApiOperation({ summary: 'Create order event' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.DRIVER)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderEventDto,
  ): Promise<OrderEvent> {
    return this.service.create(user, dto);
  }

  @ApiOperation({ summary: 'List order events' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('orders/:orderId')
  list(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderEvent[]> {
    return this.service.list(orderId);
  }
}
