import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Refund } from '@generated/prisma/client';
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTIONS_TYPE,
  PAYMENTS_REFUND_STATUS,
  PAYMENTS_TRANSACTIONS_STATUS,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreateRefundDto } from './dto/create-refund.dto';
import type { RefundQueryDto } from './dto/refund-query.dto';
import type { UpdateRefundStatusDto } from './dto/update-refund-status.dto';

/** Money a refund can come out of: captured, or a check held by operations. */
const REFUNDABLE_PAYMENT_STATUSES: PAYMENT_STATUS[] = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.AUTHORIZED,
];

/** What the portal needs to act on a refund without opening the order. */
const REFUND_INCLUDE = {
  payment: {
    select: {
      id: true,
      amount: true,
      paymentMethod: true,
      paymentProvider: true,
      providerReference: true,
      transactionId: true,
      authorizationCode: true,
      maskedCardNumber: true,
      status: true,
    },
  },
  order: {
    select: {
      id: true,
      orderCode: true,
      status: true,
      customer: {
        select: {
          companyName: true,
          user: { select: { fullName: true, email: true, phone: true } },
        },
      },
    },
  },
} satisfies Prisma.RefundInclude;

/**
 * Refunds are returned by hand (CardNET portal, a returned check): there is no
 * provider refund API wired. What this service guarantees is that recording
 * one is final and consistent: a refund only leaves PENDING once, SUCCESS
 * names the provider reference, and the payment and the order follow it.
 */
@Injectable()
export class RefundsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: RefundQueryDto = {}): Promise<Refund[]> {
    return this.prisma.refund.findMany({
      where: { ...(query.status && { status: query.status }) },
      include: REFUND_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateRefundDto, user: AuthenticatedUser): Promise<Refund> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: dto.paymentId },
        include: {
          refunds: {
            where: {
              status: {
                in: [
                  PAYMENTS_REFUND_STATUS.PENDING,
                  PAYMENTS_REFUND_STATUS.SUCCESS,
                ],
              },
            },
            select: { amount: true },
          },
        },
      });

      if (!payment) {
        throw new NotFoundException({
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: 'Payment not found',
        });
      }

      // Credit never left the customer's pocket: cancelling gives it back to
      // the line (OrdersService), a cash refund would pay it out twice.
      if (payment.paymentMethod === PAYMENT_METHOD.CORPORATE_CREDIT) {
        throw new ConflictException({
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message:
            'Corporate credit is released back to the credit line, not refunded',
        });
      }

      if (!REFUNDABLE_PAYMENT_STATUSES.includes(payment.status)) {
        throw new ConflictException({
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message: `A ${payment.status} payment holds no money to refund`,
        });
      }

      // Pending refunds count too: two open refunds for the full amount
      // would otherwise both be paid out.
      const committed = payment.refunds.reduce(
        (total, refund) => total + Number(refund.amount),
        0,
      );
      const refundable = roundMoney(Number(payment.amount) - committed);
      if (dto.amount <= 0 || dto.amount > refundable) {
        throw new BadRequestException({
          code: ERROR_CODES.BAD_REQUEST,
          message: `Refund amount must be between 0 and ${refundable.toFixed(2)}`,
        });
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: dto.amount,
          reason: dto.reason.trim(),
          status: PAYMENTS_REFUND_STATUS.PENDING,
          providerReference: null,
          createdAt: new Date(),
        },
        include: REFUND_INCLUDE,
      });

      await this.audit(tx, user, 'REFUND_REQUESTED', refund.id, null, {
        paymentId: payment.id,
        amount: dto.amount,
        reason: dto.reason.trim(),
      });

      return refund;
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateRefundStatusDto,
    user: AuthenticatedUser,
  ): Promise<Refund> {
    if (dto.status === PAYMENTS_REFUND_STATUS.PENDING) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'A refund can only be marked SUCCESS or FAILED',
      });
    }

    const providerReference = dto.providerReference?.trim() || null;
    if (dto.status === PAYMENTS_REFUND_STATUS.SUCCESS && !providerReference) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message:
          'providerReference is required to confirm a refund (CardNET refund reference, check or transfer number)',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // Compare-and-set: a refund leaves PENDING once. Re-marking SUCCESS
      // would book the money back twice; SUCCESS -> FAILED would hide it.
      const moved = await tx.refund.updateMany({
        where: { id, status: PAYMENTS_REFUND_STATUS.PENDING },
        data: { status: dto.status, providerReference },
      });

      if (moved.count !== 1) {
        const exists = await tx.refund.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!exists) {
          throw new NotFoundException({
            code: ERROR_CODES.RESOURCE_NOT_FOUND,
            message: 'Refund not found',
          });
        }
        throw new ConflictException({
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message: `Refund is already ${exists.status}`,
        });
      }

      const refund = await tx.refund.findUniqueOrThrow({ where: { id } });

      if (dto.status === PAYMENTS_REFUND_STATUS.SUCCESS) {
        await this.applyRefund(tx, refund, providerReference);
      }

      await this.audit(
        tx,
        user,
        dto.status === PAYMENTS_REFUND_STATUS.SUCCESS
          ? 'REFUND_COMPLETED'
          : 'REFUND_FAILED',
        id,
        { status: PAYMENTS_REFUND_STATUS.PENDING },
        { status: dto.status, providerReference },
      );

      return tx.refund.findUniqueOrThrow({
        where: { id },
        include: REFUND_INCLUDE,
      });
    });
  }

  /**
   * The money is back with the customer: the payment records it, becomes
   * REFUNDED once nothing of it is left, and a cancelled order whose
   * collected money is all returned shows REFUNDED instead of PAID.
   */
  private async applyRefund(
    tx: Prisma.TransactionClient,
    refund: Refund,
    providerReference: string | null,
  ): Promise<void> {
    await tx.paymentTransaction.create({
      data: {
        paymentId: refund.paymentId,
        transactionType: PAYMENT_TRANSACTIONS_TYPE.REFUND,
        amount: refund.amount,
        status: PAYMENTS_TRANSACTIONS_STATUS.SUCCESS,
        providerResponse: { refundId: refund.id, providerReference },
      },
    });

    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: refund.paymentId },
      select: {
        amount: true,
        refunds: {
          where: { status: PAYMENTS_REFUND_STATUS.SUCCESS },
          select: { amount: true },
        },
      },
    });
    const refunded = payment.refunds.reduce(
      (total, row) => total + Number(row.amount),
      0,
    );
    if (roundMoney(refunded) >= roundMoney(Number(payment.amount))) {
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: PAYMENT_STATUS.REFUNDED },
      });
    }

    const order = await tx.transportOrder.findUnique({
      where: { id: refund.orderId },
      select: {
        status: true,
        payments: { select: { status: true, paymentMethod: true } },
      },
    });
    const holdsMoney = order?.payments.some(
      (row) =>
        row.status === PAYMENT_STATUS.PAID ||
        (row.status === PAYMENT_STATUS.AUTHORIZED &&
          (row.paymentMethod === PAYMENT_METHOD.CHECK ||
            row.paymentMethod === PAYMENT_METHOD.CORPORATE_CREDIT)),
    );
    if (order?.status === STATUS_ORDERS.CANCELLED && !holdsMoney) {
      await tx.transportOrder.update({
        where: { id: refund.orderId },
        data: { paymentStatus: PAYMENT_STATUS.REFUNDED },
      });
    }
  }

  private audit(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    action: string,
    refundId: string,
    oldValues: Prisma.InputJsonObject | null,
    newValues: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action,
        entityType: 'REFUND',
        entityId: refundId,
        ...(oldValues && { oldValues }),
        newValues,
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      },
    });
  }
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
