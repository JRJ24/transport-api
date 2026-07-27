import { registerAs } from '@nestjs/config';

export const paymentConfig = registerAs('payment', () => ({
  defaultProvider: (process.env.PAYMENT_PROVIDER ?? 'cardnet').toLowerCase(),
  callbackBaseUrl: process.env.PAYMENT_CALLBACK_BASE_URL ?? '',
  customerAppBaseUrl:
    process.env.CUSTOMER_APP_BASE_URL ?? 'http://localhost:4000',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  cardnetEnvironment:
    process.env.CARDNET_ENVIRONMENT ?? process.env.CARDNET_ENV ?? 'sandbox',
  azulMerchantId: process.env.AZUL_MERCHANT_ID ?? '',
  azulApiUrl: process.env.AZUL_API_URL ?? '',
  azulApiKey: process.env.AZUL_API_KEY ?? '',
  azulSecretKey: process.env.AZUL_SECRET_KEY ?? '',
  azulWebhookSecret: process.env.AZUL_WEBHOOK_SECRET ?? '',
  azulEnvironment: process.env.AZUL_ENVIRONMENT ?? 'sandbox',
  cardnetSessionUrl:
    process.env.CARDNET_SESSION_URL ?? process.env.CARDNET_API_URL ?? '',
  cardnetAuthorizeUrl: process.env.CARDNET_AUTHORIZE_URL ?? '',
  cardnetMerchantNumber:
    process.env.CARDNET_MERCHANT_NUMBER ??
    process.env.CARDNET_MERCHANT_ID ??
    '',
  cardnetTerminal:
    process.env.CARDNET_TERMINAL ?? process.env.CARDNET_TERMINAL_ID ?? '',
  cardnetTerminalAmex: process.env.CARDNET_TERMINAL_AMEX ?? '',
  cardnetMerchantType: process.env.CARDNET_MERCHANT_TYPE ?? '',
  cardnetAcquirerCode: process.env.CARDNET_ACQUIRER_CODE ?? '',
  cardnetMerchantName: process.env.CARDNET_MERCHANT_NAME ?? '',
  cardnetReturnUrl: process.env.CARDNET_RETURN_URL ?? '',
  cardnetCancelUrl: process.env.CARDNET_CANCEL_URL ?? '',
  cardnetPageLanguage: process.env.CARDNET_PAGE_LANGUAGE ?? 'ESP',
  cardnetTransactionType: process.env.CARDNET_TRANSACTION_TYPE ?? '0200',
  cardnetCurrencyCode: process.env.CARDNET_CURRENCY_CODE ?? '214',
  cardnetTaxAmount: process.env.CARDNET_TAX_AMOUNT ?? '0',
  cardnetBillingCountryCode:
    process.env.CARDNET_3DS_BILLING_COUNTRY_CODE ?? 'DOP',
  cardnetBillingPostalCode:
    process.env.CARDNET_3DS_BILLING_POSTAL_CODE ?? '00000',
  cardnetMerchantId: process.env.CARDNET_MERCHANT_ID ?? '',
  cardnetTerminalId: process.env.CARDNET_TERMINAL_ID ?? '',
  cardnetApiUrl: process.env.CARDNET_API_URL ?? '',
  cardnetApiKey: process.env.CARDNET_API_KEY ?? '',
  cardnetSecretKey: process.env.CARDNET_SECRET_KEY ?? '',
  cardnetWebhookSecret: process.env.CARDNET_WEBHOOK_SECRET ?? '',
}));
