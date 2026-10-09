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
import type { Incident, IncidentComment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CreateIncidentCommentDto } from './dto/create-incident-comment.dto';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { EscalateIncidentDto } from './dto/escalate-incident.dto';
import { IncidentQueryDto } from './dto/incident-query.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';
import { IncidentsService } from './incidents.service';

@ApiTags('incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @ApiOperation({ summary: 'List incidents' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: IncidentQueryDto,
  ): Promise<Incident[]> {
    // El usuario decide el alcance: staff ve todo, conductor y cliente solo
    // las incidencias de una orden suya (ver IncidentsService.list).
    return this.service.list(user, query);
  }

  @ApiOperation({ summary: 'Create incident' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateIncidentDto,
  ): Promise<Incident> {
    return this.service.create(user, dto);
  }

  @ApiOperation({ summary: 'Update incident status' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentStatusDto,
  ): Promise<Incident> {
    return this.service.updateStatus(id, dto);
  }

  @ApiOperation({ summary: 'Escalate an incident (raises severity one level)' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/escalate')
  escalate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EscalateIncidentDto,
  ): Promise<Incident> {
    // Con clase el ValidationPipe rechaza (400) un reason que no sea texto,
    // en vez de dejarlo romper en el servicio (500).
    return this.service.escalate(user, id, dto.reason);
  }

  @ApiOperation({ summary: 'Add incident comment' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post(':id/comments')
  addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateIncidentCommentDto,
  ): Promise<IncidentComment> {
    return this.service.addComment(user, id, dto);
  }
}
