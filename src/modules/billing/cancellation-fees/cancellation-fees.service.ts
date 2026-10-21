import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ORDER_CANCELLATION,
  ROLES,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import {
  CUSTOMER_CANCELLABLE_STATUSES,
  cancellationFee,
  collectedAmount,
  roundMoney,
} from '@/modules/transport/orders/cancellation-policy';
import { PricingService } from '@/modules/transport/pricing/pricing.service';

export interface CancellationFeePreview {
  orderId: string;
  /** Whether this viewer may cancel the order in its current status. */
  cancellable: boolean;
  feeApplied: boolean;
  feeAmount: number;
  refundAmount: number;
  provider: 'rate-rule';
}

/** Statuses nobody can cancel from: the trip is over. */
const TERMINAL_STATUSES = new Set<STATUS_ORDERS>([
  STATUS_ORDERS.DELIVERED,
  STATUS_ORDERS.FAILED,
  STATUS_ORDERS.CANCELLED,
]);

@Injectable()
export class CancellationFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * What cancelling would cost the customer right now. Same policy as
   * OrdersService.cancel (cancellation-policy.ts), so the amount the app
   * shows before confirming is the amount the cancellation keeps; it used to
   * be a flat 10% of the total that the cancel never charged.
   */
  async calculate(
    orderId: string,
    user: AuthenticatedUser,
  ): Promise<CancellationFeePreview> {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        vehicleCategoryId: true,
        quote: { select: { breakdown: true } },
        payments: {
          select: { status: true, paymentMethod: true, amount: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    const staff = user.roles.some(
      (role) => role === ROLES.ADMIN || role === ROLES.OPERATOR,
    );
    const cancellable =
      !TERMINAL_STATUSES.has(order.status) &&
      (staff || CUSTOMER_CANCELLABLE_STATUSES.has(order.status));
    const collected = collectedAmount(order.payments);
    const feeAmount = cancellable
      ? cancellationFee({
          status: order.status,
          cancellationType: ORDER_CANCELLATION.CUSTOMER_CANCELLED,
          ruleFee: await this.pricing.cancellationFeeFor(order),
          collected,
        })
      : 0;

    return {
      orderId,
      cancellable,
      feeApplied: feeAmount > 0,
      feeAmount,
      refundAmount: cancellable ? roundMoney(collected - feeAmount) : 0,
      provider: 'rate-rule',
    };
  }
}
