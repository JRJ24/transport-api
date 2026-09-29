import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PresencePingDto } from './dto/presence-ping.dto';
import { PresenceService, type PresenceResult } from './presence.service';

@ApiTags('drivers')
@ApiBearerAuth()
@Roles(ROLES.DRIVER)
@Controller('drivers/me/presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @ApiOperation({
    summary: 'Report the position of an available driver (REST fallback)',
  })
  @Post()
  @HttpCode(HttpStatus.OK)
  ping(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PresencePingDto,
  ): Promise<PresenceResult> {
    return this.presence.recordForUser(user.id, dto);
  }

  @ApiOperation({ summary: 'Stop reporting presence (going offline)' })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.presence.removeForUser(user.id);
  }
}
