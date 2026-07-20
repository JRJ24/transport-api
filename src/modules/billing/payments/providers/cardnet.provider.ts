import type { ConfigType } from '@nestjs/config';
import axios from 'axios';
import { paymentConfig } from '@/config';
import type {
  PaymentCheckoutInput,
  PaymentCheckoutResult,
  PaymentProvider,
} from './payment-provider.interface';
import { optionalString } from './payment-provider.interface';

type PaymentConfig = ConfigType<typeof paymentConfig>;

export class CardnetPaymentProvider implements PaymentProvider {
  readonly name = 'cardnet' as const;

  constructor(private readonly config: PaymentConfig) {}

  async createCheckout(
    input: PaymentCheckoutInput,
  ): Promise<PaymentCheckoutResult> {
    if (!this.config.cardnetApiUrl) {
      return {
        provider: this.name,
        status: 'pending',
        providerReference: `cardnet_pending_${input.paymentId}`,
        rawResponse: {
          provider: this.name,
          environment: this.config.cardnetEnvironment,
          configurationMissing: true,
          message: 'CARDNET_API_URL is not configured',
        },
      };
    }

    const payload = {
      merchantId: this.config.cardnetMerchantId,
      terminalId: this.config.cardnetTerminalId,
      paymentId: input.paymentId,
      orderId: input.orderId,
      amount: input.amount,
      currency: input.currency,
      paymentMethod: input.method,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      webhookUrl: this.config.callbackBaseUrl
        ? `${this.config.callbackBaseUrl.replace(/\/$/, '')}/webhooks/cardnet`
        : undefined,
    };

    try {
      const response = await axios.post<Record<string, unknown>>(
        this.config.cardnetApiUrl,
        payload,
        {
          headers: {
            'content-type': 'application/json',
            ...(this.config.cardnetApiKey && {
              authorization: `Bearer ${this.config.cardnetApiKey}`,
            }),
          },
          timeout: 20_000,
        },
      );

      const data = response.data ?? {};

      return {
        provider: this.name,
        status: 'pending',
        providerReference:
          optionalString(data.providerReference) ??
          optionalString(data.transactionId) ??
          optionalString(data.TransactionId) ??
          optionalString(data.reference) ??
          optionalString(data.id),
        checkoutUrl:
          optionalString(data.checkoutUrl) ??
          optionalString(data.redirectUrl) ??
          optionalString(data.RedirectUrl) ??
          optionalString(data.url),
        rawResponse: data,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'CardNet request failed';

      return {
        provider: this.name,
        status: 'failed',
        providerReference: `cardnet_failed_${input.paymentId}`,
        rawResponse: { provider: this.name, error: message },
      };
    }
  }
}
