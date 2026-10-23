import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Prisma, WebhookEvent } from '@generated/prisma/client';
import { paymentConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { optionalString } from '../payments/providers/payment-provider.interface';
import type { CreateWebhookEventDto } from './dto/create-webhook-event.dto';

export type WebhookProvider = 'cardnet' | 'azul';

export interface WebhookAck {
  received: true;
  processed: boolean;
  paymentStatus?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    @Inject(paymentConfig.KEY)
    private readonly config: ConfigType<typeof paymentConfig>,
  ) {}

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

  /**
   * Provider webhooks are public, so nothing in the body is trusted: the body
   * only says "go look". CardNET payments are re-queried against CardNET with
   * the session key we stored (same path as the return URL), and Azul has no
   * verification API yet, so its events are recorded but never change state.
   */
  async receiveProvider(
    provider: WebhookProvider,
    payload: Record<string, unknown>,
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<WebhookAck> {
    const signatureVerified = this.verifySignature(
      provider,
      signature,
      rawBody,
    );

    if (provider === 'azul') {
      // Fail closed: without a secret anyone could fill the table.
      if (!signatureVerified) {
        throw new UnauthorizedException('Invalid webhook signature');
      }

      await this.recordEvent(provider, payload, signatureVerified, rawBody);
      return { received: true, processed: false };
    }

    return this.receiveCardnet(payload, signatureVerified, rawBody);
  }

  private async receiveCardnet(
    payload: Record<string, unknown>,
    signatureVerified: boolean,
    rawBody: Buffer | undefined,
  ): Promise<WebhookAck> {
    const session =
      optionalString(payload.SESSION) ??
      optionalString(payload.Session) ??
      optionalString(payload.session);

    if (!session) {
      return { received: true, processed: false };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { providerSessionId: session },
      select: { id: true, paymentProvider: true },
    });

    // Unknown sessions are dropped without writing, so unauthenticated
    // callers cannot grow webhook_events.
    if (!payment || payment.paymentProvider !== 'cardnet') {
      return { received: true, processed: false };
    }

    const event = await this.recordEvent(
      'cardnet',
      payload,
      signatureVerified,
      rawBody,
    );

    try {
      const receipt =
        await this.payments.verifyCardnetPaymentBySession(session);

      if (event) {
        await this.prisma.webhookEvent.update({
          where: { id: event.id },
          data: { processed: true, processedAt: new Date() },
        });
      }

      return { received: true, processed: true, paymentStatus: receipt.status };
    } catch (error) {
      this.logger.warn(
        `CardNET webhook verification failed for payment ${payment.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { received: true, processed: false };
    }
  }

  /** Returns the new event, or null when this delivery was already stored. */
  private async recordEvent(
    provider: WebhookProvider,
    payload: Record<string, unknown>,
    signatureVerified: boolean,
    rawBody: Buffer | undefined,
  ): Promise<WebhookEvent | null> {
    const externalEventId =
      optionalString(payload.externalEventId) ??
      optionalString(payload.eventId) ??
      optionalString(payload.transactionId) ??
      optionalString(payload.TransactionId) ??
      optionalString(payload.reference) ??
      optionalString(payload.id) ??
      // No id in the payload: a fingerprint of the body, so a retried delivery
      // maps to the same event (a timestamp made every retry a new one).
      `body-${createHash('sha256')
        .update(rawBody ?? JSON.stringify(payload))
        .digest('hex')}`;
    const eventType =
      optionalString(payload.eventType) ??
      optionalString(payload.type) ??
      optionalString(payload.status) ??
      optionalString(payload.Status) ??
      `${provider}.payment.updated`;
    const scopedExternalId = `${provider}:${externalEventId}`;

    try {
      // Unique external_event_id: a concurrent retry loses the race with P2002
      // instead of storing a second copy.
      return await this.prisma.webhookEvent.create({
        data: {
          eventType,
          externalEventId: scopedExternalId,
          payload: {
            provider,
            signatureVerified,
            payload,
          } as Prisma.InputJsonObject,
          processed: false,
          processedAt: new Date(),
          createdAt: new Date(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * HMAC-SHA256 of the raw body, hex, optionally prefixed with "sha256=".
   * With a secret configured a bad or missing signature is rejected; without
   * one the request is accepted but reported as unverified.
   */
  private verifySignature(
    provider: WebhookProvider,
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ): boolean {
    const secret =
      provider === 'cardnet'
        ? this.config.cardnetWebhookSecret
        : this.config.azulWebhookSecret;

    if (!secret) {
      return false;
    }

    const provided = signature
      ?.trim()
      .replace(/^sha256=/i, '')
      .toLowerCase();

    if (!provided || !rawBody || !/^[0-9a-f]+$/.test(provided)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest();
    const received = Buffer.from(provided, 'hex');

    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
