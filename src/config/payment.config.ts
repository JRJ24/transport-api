import { registerAs } from '@nestjs/config';

export const paymentConfig = registerAs('payment', () => ({
  defaultProvider: process.env.PAYMENT_PROVIDER ?? 'stripe',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  azulMerchantId: process.env.AZUL_MERCHANT_ID ?? '',
  cardnetMerchantId: process.env.CARDNET_MERCHANT_ID ?? '',
}));
