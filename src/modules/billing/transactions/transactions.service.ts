import { Injectable } from '@nestjs/common';
import type { PaymentTransaction, Prisma } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(paymentId?: string): Promise<PaymentTransaction[]> {
    return this.prisma.paymentTransaction.findMany({
      where: { ...(paymentId && { paymentId }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(dto: CreateTransactionDto): Promise<PaymentTransaction> {
    return this.prisma.paymentTransaction.create({
      data: {
        paymentId: dto.paymentId,
        transactionType: dto.transactionType,
        amount: dto.amount,
        status: dto.status,
        providerResponse: (dto.providerResponse ?? {
          provider: 'internal-mock',
        }) as Prisma.InputJsonObject,
      },
    });
  }
}
