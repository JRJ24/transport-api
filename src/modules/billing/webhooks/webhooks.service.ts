import { Injectable } from '@nestjs/common';
import type { Prisma, WebhookEvent } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { CreateWebhookEventDto } from './dto/create-webhook-event.dto';

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<WebhookEvent[]> {
    return this.prisma.webhookEvent.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  receive(dto: CreateWebhookEventDto): Promise<WebhookEvent> {
    return this.prisma.webhookEvent.create({
      data: {
        eventType: dto.eventType.trim(),
        externalEventId: dto.externalEventId.trim(),
        payload: dto.payload as Prisma.InputJsonObject,
        processed: true,
        processedAt: new Date(),
        createdAt: new Date(),
      },
    });
  }
}
