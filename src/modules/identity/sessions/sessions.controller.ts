import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import {
  toSessionResponse,
  type SessionResponse,
} from './presenters/session.presenter';
import { SessionsService } from './sessions.service';

@ApiTags('sessions')
@ApiBearerAuth()
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @ApiOperation({ summary: 'List my active sessions (devices)' })
  @Get('me')
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SessionResponse[]> {
    const sessions = await this.sessionsService.listSessions(user.id);

    return sessions.map((session) =>
      toSessionResponse(session, user.sessionId),
    );
  }

  @ApiOperation({
    summary: 'Revoke a session (own device, or any device as ADMIN)',
  })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.sessionsService.revokeSessionFor(id, user);
  }

  @ApiOperation({ summary: 'Revoke every session of a user (TMS)' })
  @Roles(ROLES.ADMIN)
  @Delete('users/:userId')
  async revokeAllForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ revokedCount: number }> {
    const revokedCount = await this.sessionsService.revokeAllForUser(userId);

    return { revokedCount };
  }
}
