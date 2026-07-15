import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PaginatedResult } from '@/common/interfaces/pagination.interface';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { toUserResponse, type UserResponse } from './presenters/user.presenter';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'List users (TMS)' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get()
  findAll(
    @Query() query: UserQueryDto,
  ): Promise<PaginatedResult<UserResponse>> {
    return this.usersService.findAll(query);
  }

  @ApiOperation({ summary: 'Get my profile' })
  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return toUserResponse(await this.usersService.getByIdWithRoles(user.id));
  }

  @ApiOperation({ summary: 'Update my profile' })
  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    return toUserResponse(await this.usersService.updateProfile(user.id, dto));
  }

  @ApiOperation({ summary: 'Get a user by id (TMS)' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserResponse> {
    return toUserResponse(await this.usersService.getByIdWithRoles(id));
  }
}
