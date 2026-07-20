import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { paymentConfig } from '@/config';
import { AzulPaymentProvider } from './azul.provider';
import { CardnetPaymentProvider } from './cardnet.provider';
import { InternalMockPaymentProvider } from './internal-mock.provider';
import type {
  PaymentProvider,
  PaymentProviderName,
} from './payment-provider.interface';

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: Record<PaymentProviderName, PaymentProvider>;

  constructor(
    @Inject(paymentConfig.KEY)
    private readonly config: ConfigType<typeof paymentConfig>,
  ) {
    this.providers = {
      cardnet: new CardnetPaymentProvider(config),
      azul: new AzulPaymentProvider(config),
      'internal-mock': new InternalMockPaymentProvider(),
    };
  }

  get(provider?: string): PaymentProvider {
    const selected = (
      provider ??
      this.config.defaultProvider ??
      'cardnet'
    ).toLowerCase();

    if (
      selected === 'azul' ||
      selected === 'cardnet' ||
      selected === 'internal-mock'
    ) {
      return this.providers[selected];
    }

    return this.providers.cardnet;
  }
}
