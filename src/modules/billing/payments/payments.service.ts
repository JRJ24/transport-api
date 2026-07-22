import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Payment,
  PaymentTransaction,
  Prisma,
} from '@generated/prisma/client';
import {
  PAYMENT_STATUS,
  PAYMENT_TRANSACTIONS_TYPE,
  PAYMENTS_TRANSACTIONS_STATUS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { PrismaService } from '@/database/prisma.service';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import type { PaymentCheckoutResult } from './providers/payment-provider.interface';

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface CreatePaymentResult {
  payment: Payment;
  transaction: PaymentTransaction;
  provider: string;
  providerReference?: string;
  checkoutUrl?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
  ) {}

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

  async create(dto: CreatePaymentDto): Promise<CreatePaymentResult> {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: dto.orderId },
      include: {
        customer: { include: { user: { select: SAFE_USER_SELECT } } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        amount: dto.amount ?? order.totalAmount,
        currency: dto.currency?.trim().toUpperCase() ?? 'DOP',
        paymentMethod: dto.paymentMethod,
        paymentProvider: this.providers.get(dto.provider).name,
        status: PAYMENT_STATUS.PENDING,
        providerReference: null,
      },
    });

    const provider = this.providers.get(dto.provider);
    const checkout = await provider.createCheckout({
      paymentId: payment.id,
      orderId: order.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      method: payment.paymentMethod,
      customerId: order.customerId,
      customerEmail: order.customer.billingEmail ?? order.customer.user.email,
      returnUrl: dto.returnUrl,
      cancelUrl: dto.cancelUrl,
    });

    const [updatedPayment, transaction] = await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentProvider: checkout.provider,
          providerReference: checkout.providerReference ?? null,
          status: this.paymentStatusFromCheckout(checkout),
          ...(checkout.status === 'paid' && { paidAt: new Date() }),
        },
      }),
      this.prisma.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          transactionType: PAYMENT_TRANSACTIONS_TYPE.AUTHORIZATION,
          amount: payment.amount,
          status: this.transactionStatusFromCheckout(checkout),
          providerResponse: checkout.rawResponse as Prisma.InputJsonObject,
        },
      }),
    ]);

    await this.prisma.transportOrder.update({
      where: { id: order.id },
      data: { paymentStatus: updatedPayment.status },
    });

    return {
      payment: updatedPayment,
      transaction,
      provider: checkout.provider,
      providerReference: checkout.providerReference,
      checkoutUrl: checkout.checkoutUrl,
    };
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

  private paymentStatusFromCheckout(
    checkout: PaymentCheckoutResult,
  ): PAYMENT_STATUS {
    switch (checkout.status) {
      case 'authorized':
        return PAYMENT_STATUS.AUTHORIZED;
      case 'paid':
        return PAYMENT_STATUS.PAID;
      case 'failed':
        return PAYMENT_STATUS.FAILED;
      default:
        return PAYMENT_STATUS.PENDING;
    }
  }

  private transactionStatusFromCheckout(
    checkout: PaymentCheckoutResult,
  ): PAYMENTS_TRANSACTIONS_STATUS {
    switch (checkout.status) {
      case 'authorized':
      case 'paid':
        return PAYMENTS_TRANSACTIONS_STATUS.SUCCESS;
      case 'failed':
        return PAYMENTS_TRANSACTIONS_STATUS.FAILED;
      default:
        return PAYMENTS_TRANSACTIONS_STATUS.PENDING;
    }
  }
}
