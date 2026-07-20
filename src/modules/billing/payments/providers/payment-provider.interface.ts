import type { PAYMENT_METHOD } from '@generated/prisma/enums';

export type PaymentProviderName = 'cardnet' | 'azul' | 'internal-mock';
export type ProviderPaymentStatus =
  'pending' | 'authorized' | 'paid' | 'failed';

export interface PaymentCheckoutInput {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  method: PAYMENT_METHOD;
  customerId: string;
  customerEmail?: string | null;
  returnUrl?: string;
  cancelUrl?: string;
}

export interface PaymentCheckoutResult {
  provider: PaymentProviderName;
  status: ProviderPaymentStatus;
  providerReference?: string;
  checkoutUrl?: string;
  rawResponse: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult>;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}
