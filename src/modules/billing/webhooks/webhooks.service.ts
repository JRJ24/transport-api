import { Injectable } from '@nestjs/common';
import type { Prisma, WebhookEvent } from '@generated/prisma/client';
import {
  PAYMENT_STATUS,
  PAYMENT_TRANSACTIONS_TYPE,
  PAYMENTS_TRANSACTIONS_STATUS,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import { optionalString } from '../payments/providers/payment-provider.interface';
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

  async receiveProvider(
    provider: 'cardnet' | 'azul',
    payload: Record<string, unknown>,
    signature?: string,
  ): Promise<WebhookEvent> {
    const externalEventId =
      optionalString(payload.externalEventId) ??
      optionalString(payload.eventId) ??
      optionalString(payload.transactionId) ??
      optionalString(payload.TransactionId) ??
      optionalString(payload.reference) ??
      optionalString(payload.id) ??
      `${provider}_${Date.now()}`;
    const eventType =
      optionalString(payload.eventType) ??
      optionalString(payload.type) ??
      optionalString(payload.status) ??
      optionalString(payload.Status) ??
      `${provider}.payment.updated`;
    const scopedExternalId = `${provider}:${externalEventId}`;

    const existing = await this.prisma.webhookEvent.findFirst({
      where: { externalEventId: scopedExternalId },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const event = await tx.webhookEvent.create({
        data: {
          eventType,
          externalEventId: scopedExternalId,
          payload: {
            provider,
            signaturePresent: Boolean(signature),
            payload,
          } as Prisma.InputJsonObject,
          processed: false,
          processedAt: new Date(),
          createdAt: new Date(),
        },
      });

      const payment = await this.findPaymentForWebhook(tx, payload);
      const status = this.statusFromWebhook(payload);

      if (!payment || !status) {
        return event;
      }

      if (payment && status) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status,
            ...(status === PAYMENT_STATUS.PAID && { paidAt: new Date() }),
          },
        });

        await tx.transportOrder.update({
          where: { id: payment.orderId },
          data: { paymentStatus: status },
        });

        if (status === PAYMENT_STATUS.PAID) {
          await tx.transportOrder.updateMany({
            where: {
              id: payment.orderId,
              status: {
                in: [
                  STATUS_ORDERS.DRAFT,
                  STATUS_ORDERS.PENDING_QUOTE,
                  STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
                  STATUS_ORDERS.PENDING_PAYMENT,
                  STATUS_ORDERS.CONFIRMED,
                ],
              },
            },
            data: { status: STATUS_ORDERS.REQUESTED },
          });
        }

        await tx.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            transactionType:
              status === PAYMENT_STATUS.REFUNDED
                ? PAYMENT_TRANSACTIONS_TYPE.REFUND
                : PAYMENT_TRANSACTIONS_TYPE.CAPTURE,
            amount: payment.amount,
            status:
              status === PAYMENT_STATUS.FAILED
                ? PAYMENTS_TRANSACTIONS_STATUS.FAILED
                : PAYMENTS_TRANSACTIONS_STATUS.SUCCESS,
            providerResponse: payload as Prisma.InputJsonObject,
          },
        });
      }

      return tx.webhookEvent.update({
        where: { id: event.id },
        data: { processed: true, processedAt: new Date() },
      });
    });
  }

  private async findPaymentForWebhook(
    tx: Prisma.TransactionClient,
    payload: Record<string, unknown>,
  ) {
    const paymentId =
      optionalString(payload.paymentId) ?? optionalString(payload.PaymentId);

    if (paymentId) {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });

      if (payment) {
        return payment;
      }
    }

    const providerReference =
      optionalString(payload.SESSION) ??
      optionalString(payload.Session) ??
      optionalString(payload.session) ??
      optionalString(payload.providerReference) ??
      optionalString(payload.transactionId) ??
      optionalString(payload.TransactionId) ??
      optionalString(payload.TransactionID) ??
      optionalString(payload.reference) ??
      optionalString(payload.Reference);

    const orderCode =
      optionalString(payload.OrdenID) ??
      optionalString(payload.OrdenId) ??
      optionalString(payload.orderCode) ??
      optionalString(payload.orderId);

    if (providerReference) {
      const payment = await tx.payment.findFirst({
        where: {
          OR: [
            { providerReference },
            { providerSessionId: providerReference },
            { transactionId: providerReference },
          ],
        },
      });

      if (payment) {
        return payment;
      }
    }

    if (!orderCode) {
      return null;
    }

    return tx.payment.findFirst({
      where: { order: { orderCode } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private statusFromWebhook(
    payload: Record<string, unknown>,
  ): PAYMENT_STATUS | undefined {
    const status = (
      optionalString(payload.status) ??
      optionalString(payload.Status) ??
      optionalString(payload.ResponseCode) ??
      optionalString(payload.responseCode) ??
      optionalString(payload.RemoteResponseCode) ??
      ''
    ).toLowerCase();

    if (['paid', 'approved', 'success', 'captured', '00'].includes(status)) {
      return PAYMENT_STATUS.PAID;
    }

    if (['authorized', 'auth'].includes(status)) {
      return PAYMENT_STATUS.AUTHORIZED;
    }

    if (['refunded', 'refund'].includes(status)) {
      return PAYMENT_STATUS.REFUNDED;
    }

    if (['failed', 'declined', 'error', 'rejected'].includes(status)) {
      return PAYMENT_STATUS.FAILED;
    }

    return undefined;
  }
}
