import { Injectable, NotFoundException } from '@nestjs/common';
import type { Refund } from '@generated/prisma/client';
import { PAYMENTS_REFUND_STATUS } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';
import type { CreateRefundDto } from './dto/create-refund.dto';
import type { UpdateRefundStatusDto } from './dto/update-refund-status.dto';

@Injectable()
export class RefundsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Refund[]> {
    return this.prisma.refund.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreateRefundDto): Promise<Refund> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.paymentId },
    });

    if (!payment) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Payment not found',
      });
    }

    return this.prisma.refund.create({
      data: {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: dto.amount,
        reason: dto.reason.trim(),
        status: PAYMENTS_REFUND_STATUS.PENDING,
        providerReference: null,
        createdAt: new Date(),
      },
    });
  }

  updateStatus(id: string, dto: UpdateRefundStatusDto): Promise<Refund> {
    return this.prisma.refund.update({
      where: { id },
      data: {
        status: dto.status,
        providerReference: dto.providerReference ?? undefined,
      },
    });
  }
}
