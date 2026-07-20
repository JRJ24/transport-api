import { registerAs } from '@nestjs/config';

export const paymentConfig = registerAs('payment', () => ({
  defaultProvider: (process.env.PAYMENT_PROVIDER ?? 'cardnet').toLowerCase(),
  callbackBaseUrl: process.env.PAYMENT_CALLBACK_BASE_URL ?? '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  cardnetEnvironment: process.env.CARDNET_ENVIRONMENT ?? 'sandbox',
  azulMerchantId: process.env.AZUL_MERCHANT_ID ?? '',
  azulApiUrl: process.env.AZUL_API_URL ?? '',
  azulApiKey: process.env.AZUL_API_KEY ?? '',
  azulSecretKey: process.env.AZUL_SECRET_KEY ?? '',
  azulWebhookSecret: process.env.AZUL_WEBHOOK_SECRET ?? '',
  azulEnvironment: process.env.AZUL_ENVIRONMENT ?? 'sandbox',
  cardnetMerchantId: process.env.CARDNET_MERCHANT_ID ?? '',
  cardnetTerminalId: process.env.CARDNET_TERMINAL_ID ?? '',
  cardnetApiUrl: process.env.CARDNET_API_URL ?? '',
  cardnetApiKey: process.env.CARDNET_API_KEY ?? '',
  cardnetSecretKey: process.env.CARDNET_SECRET_KEY ?? '',
  cardnetWebhookSecret: process.env.CARDNET_WEBHOOK_SECRET ?? '',
}));
