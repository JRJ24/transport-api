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
import type { OrderAssignment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';

@ApiTags('assignments')
@ApiBearerAuth()
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  @ApiOperation({ summary: 'List assignments' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get()
  list(): Promise<OrderAssignment[]> {
    return this.service.list();
  }

  @ApiOperation({ summary: 'Create an order assignment' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAssignmentDto,
  ): Promise<OrderAssignment> {
    return this.service.create(user, dto);
  }

  @ApiOperation({ summary: 'Accept an assignment' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderAssignment> {
    return this.service.accept(id, user);
  }

  @ApiOperation({ summary: 'Reject an assignment' })
  @Roles(ROLES.DRIVER, ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderAssignment> {
    return this.service.reject(id, user);
  }

  @ApiOperation({ summary: 'Complete an assignment' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string): Promise<OrderAssignment> {
    return this.service.complete(id);
  }
}
