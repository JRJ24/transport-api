import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SystemParameter } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { ParameterQueryDto } from './dto/parameter-query.dto';
import { UpsertParameterDto } from './dto/upsert-parameter.dto';
import { ParametersService } from './parameters.service';

@ApiTags('parameters')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@Controller('parameters')
export class ParametersController {
  constructor(private readonly service: ParametersService) {}

  @ApiOperation({ summary: 'List system parameters' })
  @Get()
  list(@Query() query: ParameterQueryDto): Promise<SystemParameter[]> {
    return this.service.list(query);
  }

  @ApiOperation({ summary: 'Create or update system parameter' })
  @Put()
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertParameterDto,
  ): Promise<SystemParameter> {
    return this.service.upsert(user, dto);
  }
}
