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
import { StartTripDto } from './dto/start-trip.dto';
import { TripsService } from './trips.service';

@ApiTags('trips')
@ApiBearerAuth()
@Controller('trips')
export class TripsController {
  constructor(private readonly service: TripsService) {}

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
  listByOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<TrackingSession[]> {
    return this.service.listByOrder(orderId);
  }
}
