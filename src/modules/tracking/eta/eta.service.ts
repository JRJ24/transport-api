import { Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class EtaService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(orderId: string): Promise<{
    orderId: string;
    estimatedDurationMin: number;
    elapsedMin: number;
    remainingMin: number;
    lastLocationAt: Date | null;
    provider: 'internal-mock';
  }> {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    const tracking = await this.prisma.trackingSession.findFirst({
      where: { orderId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    const elapsedMin = tracking
      ? Math.max(
          Math.floor((Date.now() - tracking.startedAt.getTime()) / 60_000),
          0,
        )
      : 0;

    return {
      orderId,
      estimatedDurationMin: order.estimatedDurationMin,
      elapsedMin,
      remainingMin: Math.max(order.estimatedDurationMin - elapsedMin, 0),
      lastLocationAt: tracking?.lastLocationAt ?? null,
      provider: 'internal-mock',
    };
  }
}
