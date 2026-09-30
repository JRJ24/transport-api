import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import {
  RuntimeSettingsService,
  type RuntimeSettingView,
} from './runtime-settings.service';
import { SystemStatusService } from './system-status.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: RuntimeSettingsService,
    private readonly status: SystemStatusService,
  ) {}

  @ApiOperation({
    summary: 'Settings editable at runtime, with their effective value',
  })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get('runtime')
  list(): RuntimeSettingView[] {
    return this.settings.list();
  }

  @ApiOperation({
    summary: 'Change a runtime setting (applies within seconds, audited)',
  })
  @ApiBody({ schema: { type: 'object', properties: { value: {} } } })
  @Roles(ROLES.ADMIN)
  @Put('runtime/:key')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() body: { value: unknown },
  ): Promise<RuntimeSettingView> {
    return this.settings.update(user.id, key, body?.value);
  }

  @ApiOperation({ summary: 'Real checks of every dependency (no secrets)' })
  @Roles(ROLES.ADMIN)
  @Get('system-status')
  systemStatus() {
    return this.status.checks();
  }
}
