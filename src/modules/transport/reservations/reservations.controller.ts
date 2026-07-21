import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Reservation } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationQueryDto } from './dto/reservation-query.dto';
import { RescheduleReservationDto } from './dto/reschedule-reservation.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('reservations')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERATOR)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @ApiOperation({ summary: 'List reservations' })
  @Get()
  list(@Query() query: ReservationQueryDto): Promise<Reservation[]> {
    return this.service.list(query);
  }

  @ApiOperation({ summary: 'Create a reservation for an order' })
  @Post()
  create(@Body() dto: CreateReservationDto): Promise<Reservation> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Reschedule a reservation' })
  @Patch(':id/reschedule')
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleReservationDto,
  ): Promise<Reservation> {
    return this.service.reschedule(id, dto);
  }

  @ApiOperation({ summary: 'Cancel a reservation' })
  @Patch(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<Reservation> {
    return this.service.cancel(id);
  }

  @ApiOperation({ summary: 'Complete a reservation' })
  @Patch(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string): Promise<Reservation> {
    return this.service.complete(id);
  }
}
