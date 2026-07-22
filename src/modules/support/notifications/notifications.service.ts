import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@generated/prisma/client';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import type { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        title: dto.title.trim(),
        message: dto.message.trim(),
        notificationType: dto.notificationType,
        data: (dto.data ?? {}) as Prisma.InputJsonObject,
      },
    });

    this.realtime.emitNotificationCreated(dto.userId, {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      notificationType: notification.notificationType,
      data: notification.data,
      createdAt: notification.createdAt.toISOString(),
    });

    return notification;
  }

  listMine(userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification || notification.userId !== userId) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You cannot modify this notification',
      });
    }

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
