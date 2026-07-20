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

export class AzulPaymentProvider implements PaymentProvider {
  readonly name = 'azul' as const;

  constructor(private readonly config: PaymentConfig) {}

  async createCheckout(
    input: PaymentCheckoutInput,
  ): Promise<PaymentCheckoutResult> {
    if (!this.config.azulApiUrl) {
      return {
        provider: this.name,
        status: 'pending',
        providerReference: `azul_pending_${input.paymentId}`,
        rawResponse: {
          provider: this.name,
          environment: this.config.azulEnvironment,
          configurationMissing: true,
          message: 'AZUL_API_URL is not configured',
        },
      };
    }

    const payload = {
      merchantId: this.config.azulMerchantId,
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
        ? `${this.config.callbackBaseUrl.replace(/\/$/, '')}/webhooks/azul`
        : undefined,
    };

    try {
      const response = await axios.post<Record<string, unknown>>(
        this.config.azulApiUrl,
        payload,
        {
          headers: {
            'content-type': 'application/json',
            ...(this.config.azulApiKey && {
              authorization: `Bearer ${this.config.azulApiKey}`,
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
          optionalString(data.authorizationCode) ??
          optionalString(data.reference) ??
          optionalString(data.id),
        checkoutUrl:
          optionalString(data.checkoutUrl) ??
          optionalString(data.redirectUrl) ??
          optionalString(data.url),
        rawResponse: data,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Azul request failed';

      return {
        provider: this.name,
        status: 'failed',
        providerReference: `azul_failed_${input.paymentId}`,
        rawResponse: { provider: this.name, error: message },
      };
    }
  }
}
