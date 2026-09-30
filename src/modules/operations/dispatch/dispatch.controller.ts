import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { DriverOffer, OrderAssignment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { MatchingResult } from '../matching/matching.types';
import { AssignCandidateDto, DispatchOrderDto } from './dto/dispatch-order.dto';
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
  @ApiQuery({ name: 'orderId', required: false, format: 'uuid' })
  @Get('available-drivers')
  availableDrivers(
    @Query('orderId', new ParseUUIDPipe({ optional: true })) orderId?: string,
  ) {
    return this.service.availableDrivers(orderId);
  }

  @ApiOperation({ summary: 'Available drivers with a fresh position (map)' })
  @Get('live-drivers')
  liveDrivers() {
    return this.service.liveDrivers();
  }

  @ApiOperation({
    summary:
      'Ranked drivers for an order (H3 proximity, road ETA) with exclusion reasons',
  })
  @Get('orders/:id/candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string): Promise<MatchingResult> {
    return this.service.candidates(id);
  }

  @ApiOperation({ summary: 'Dispatch offers made for an order (audit trail)' })
  @Get('orders/:id/offers')
  offers(@Param('id', ParseUUIDPipe) id: string): Promise<DriverOffer[]> {
    return this.service.offers(id);
  }

  @ApiOperation({ summary: 'Assign a ranked candidate to an order' })
  @Post('orders/:id/assign')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignCandidateDto,
  ): Promise<OrderAssignment> {
    return this.service.assign(user, id, dto);
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
