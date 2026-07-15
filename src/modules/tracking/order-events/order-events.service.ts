import { Injectable } from '@nestjs/common';
import type { OrderEvent, Prisma } from '@generated/prisma/client';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreateOrderEventDto } from './dto/create-order-event.dto';

@Injectable()
export class OrderEventsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    user: AuthenticatedUser,
    dto: CreateOrderEventDto,
  ): Promise<OrderEvent> {
    return this.prisma.orderEvent.create({
      data: {
        orderId: dto.orderId,
        eventType: dto.eventType,
        actorUserId: user.id,
        description: dto.description.trim(),
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonObject,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? 0,
      },
    });
  }

  list(orderId: string): Promise<OrderEvent[]> {
    return this.prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
