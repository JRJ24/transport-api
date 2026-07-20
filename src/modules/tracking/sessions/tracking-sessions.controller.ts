import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { DriverLocation, TrackingSession } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { BatchLocationsDto } from './dto/batch-locations.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { TrackingLocationDto } from './dto/tracking-location.dto';
import {
  type BatchResult,
  TrackingSessionsService,
} from './tracking-sessions.service';

@ApiTags('tracking-sessions')
@ApiBearerAuth()
@Controller('tracking/sessions')
export class TrackingSessionsController {
  constructor(private readonly service: TrackingSessionsService) {}

  @ApiOperation({ summary: 'Create or recover the active tracking session' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSessionDto,
  ): Promise<TrackingSession> {
    return this.service.createOrRecover(user, dto);
  }

  @ApiOperation({ summary: 'Get the active tracking session for the driver' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Get('active')
  active(
    @CurrentUser() user: AuthenticatedUser,
    @Query('orderId') orderId?: string,
  ): Promise<TrackingSession | null> {
    return this.service.getActive(user, orderId);
  }

  @ApiOperation({ summary: 'Record a single GPS fix' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post(':sessionId/locations')
  addLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: TrackingLocationDto,
  ): Promise<DriverLocation> {
    return this.service.addLocation(user, sessionId, dto);
  }

  @ApiOperation({ summary: 'Record a batch of GPS fixes (offline sync)' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post(':sessionId/locations/batch')
  addBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: BatchLocationsDto,
  ): Promise<BatchResult> {
    return this.service.addLocationBatch(user, sessionId, dto.locations);
  }

  @ApiOperation({ summary: 'Stop / finalize a tracking session' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Post(':sessionId/stop')
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<TrackingSession> {
    return this.service.stop(user, sessionId);
  }
}
