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
import type { Notification } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { TestNotificationDto } from './dto/test-notification.dto';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly dispatcher: NotificationDispatcherService,
  ) {}

  @ApiOperation({ summary: 'List my notifications' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser): Promise<Notification[]> {
    return this.service.listMine(user.id);
  }

  @ApiOperation({ summary: 'Create an internal notification' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Post()
  create(@Body() dto: CreateNotificationDto): Promise<Notification> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Send a test push notification' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.DRIVER)
  @Post('test')
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TestNotificationDto,
  ): Promise<Notification> {
    const isPrivileged = user.roles.some(
      (role) => role === ROLES.ADMIN || role === ROLES.OPERATOR,
    );
    const target = isPrivileged && dto.userId ? dto.userId : user.id;
    return this.dispatcher.dispatch(target, 'TEST', {
      message: dto.message,
      orderId: dto.orderId,
    });
  }

  @ApiOperation({ summary: 'Mark notification as read' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Patch(':id/read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Notification> {
    return this.service.markRead(id, user.id);
  }
}
