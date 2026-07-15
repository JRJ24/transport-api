import { Injectable } from '@nestjs/common';
import type { Notification, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateNotificationDto): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: dto.userId,
        title: dto.title.trim(),
        message: dto.message.trim(),
        notificationType: dto.notificationType,
        data: (dto.data ?? {}) as Prisma.InputJsonObject,
      },
    });
  }

  listMine(userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  markRead(id: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }
}
