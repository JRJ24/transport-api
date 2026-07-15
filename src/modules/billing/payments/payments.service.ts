import { Injectable, NotFoundException } from '@nestjs/common';
import type { Payment } from '@generated/prisma/client';
import { PAYMENT_STATUS } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      include: { paymentsTransactions: true, refunds: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({
      where: { id },
      include: { paymentsTransactions: true, refunds: true },
    });
  }

  async create(dto: CreatePaymentDto): Promise<Payment> {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: dto.orderId },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    return this.prisma.payment.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        amount: dto.amount ?? order.totalAmount,
        currency: dto.currency?.trim().toUpperCase() ?? 'DOP',
        paymentMethod: dto.paymentMethod,
        paymentProvider: 'internal-mock',
        status: PAYMENT_STATUS.PENDING,
        providerReference: null,
      },
    });
  }

  updateStatus(id: string, dto: UpdatePaymentStatusDto): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id },
        data: {
          status: dto.status,
          providerReference: dto.providerReference ?? undefined,
          ...(dto.status === PAYMENT_STATUS.PAID && { paidAt: new Date() }),
        },
      });

      await tx.transportOrder.update({
        where: { id: payment.orderId },
        data: { paymentStatus: dto.status },
      });

      return payment;
    });
  }
}
