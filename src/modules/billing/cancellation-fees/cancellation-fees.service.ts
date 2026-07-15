import { Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class CancellationFeesService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(orderId: string): Promise<{
    orderId: string;
    feeApplied: boolean;
    feeAmount: number;
    refundAmount: number;
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

    const totalAmount = Number(order.totalAmount);
    const feeAmount = Number((totalAmount * 0.1).toFixed(2));

    return {
      orderId,
      feeApplied: feeAmount > 0,
      feeAmount,
      refundAmount: Math.max(Number((totalAmount - feeAmount).toFixed(2)), 0),
      provider: 'internal-mock',
    };
  }
}
