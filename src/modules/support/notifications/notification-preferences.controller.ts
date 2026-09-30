import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import {
  NotificationPreferencesService,
  type NotificationPreferenceView,
} from './notification-preferences.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('users/me/notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @ApiOperation({ summary: 'My notification preferences per category' })
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferenceView[]> {
    return this.preferences.list(user.id);
  }

  @ApiOperation({
    summary: 'Update my preferences (order, payment and system push stay on)',
  })
  @Put()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceView[]> {
    return this.preferences.update(user.id, dto.items);
  }
}
