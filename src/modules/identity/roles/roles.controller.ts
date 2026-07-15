import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Role } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { AssignRoleDto } from './dto/assign-role.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: 'List roles' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get()
  findAll(): Promise<Role[]> {
    return this.rolesService.findAll();
  }

  @ApiOperation({ summary: 'Assign a role to a user' })
  @Roles(ROLES.ADMIN)
  @Post('assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  async assign(@Body() dto: AssignRoleDto): Promise<void> {
    await this.rolesService.assign(dto.userId, dto.role);
  }

  @ApiOperation({ summary: 'Revoke a role from a user' })
  @Roles(ROLES.ADMIN)
  @Post('revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Body() dto: AssignRoleDto): Promise<void> {
    await this.rolesService.revoke(dto.userId, dto.role);
  }
}
