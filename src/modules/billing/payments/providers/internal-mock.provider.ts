import type {
  PaymentProvider,
  PaymentCheckoutInput,
  PaymentCheckoutResult,
} from './payment-provider.interface';

export class InternalMockPaymentProvider implements PaymentProvider {
  readonly name = 'internal-mock' as const;

  createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult> {
    return Promise.resolve({
      provider: this.name,
      status: 'pending',
      providerReference: `mock_${input.paymentId}`,
      rawResponse: {
        provider: this.name,
        paymentId: input.paymentId,
        message: 'Internal mock checkout created',
      },
    });
  }
}
