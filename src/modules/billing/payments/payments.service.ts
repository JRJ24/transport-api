import { randomInt } from 'crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type {
  Payment,
  PaymentTransaction,
  Prisma,
  TransportOrder,
} from '@generated/prisma/client';
import {
  CHECK_STATUS,
  CREDIT_ACCOUNT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTIONS_TYPE,
  PAYMENTS_TRANSACTIONS_STATUS,
  ROLES,
  STATUS_ORDERS,
  STOP_TYPE,
  TYPE_CUSTOMER,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { paymentConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { CardnetGateway } from './cardnet.gateway';
import type { ApproveCorporateCreditPaymentDto } from './dto/approve-corporate-credit-payment.dto';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type { RegisterCheckPaymentDto } from './dto/register-check-payment.dto';
import type { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import {
  optionalString,
  type PaymentCheckoutResult,
} from './providers/payment-provider.interface';

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DISPATCHABLE_MANUAL_METHODS = new Set<PAYMENT_METHOD>([
  PAYMENT_METHOD.CHECK,
  PAYMENT_METHOD.CORPORATE_CREDIT,
]);

const ORDER_STATUSES_AWAITING_PAYMENT = new Set<STATUS_ORDERS>([
  STATUS_ORDERS.DRAFT,
  STATUS_ORDERS.PENDING_QUOTE,
  STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
  STATUS_ORDERS.PENDING_PAYMENT,
  STATUS_ORDERS.CONFIRMED,
]);

type CardnetOrder = Prisma.TransportOrderGetPayload<{
  include: {
    customer: {
      include: {
        user: { select: typeof SAFE_USER_SELECT };
        customerAddresses: true;
      };
    };
    orderStops: true;
  };
}>;

type PaymentWithOrder = Payment & {
  order: TransportOrder & { customer?: { userId: string } };
  paymentsTransactions?: PaymentTransaction[];
};

export interface CreatePaymentResult {
  payment: Payment;
  transaction: PaymentTransaction;
  provider: string;
  providerReference?: string;
  checkoutUrl?: string;
}

export interface CreateCardnetSessionResult {
  paymentId: string;
  orderId: string;
  session: string;
  authorizeUrl: string;
  expiresAt: Date;
}

export interface PaymentReceiptResult {
  paymentId: string;
  orderId: string;
  orderCode?: string;
  status: PAYMENT_STATUS;
  amount: number;
  currency: string;
  provider: string | null;
  providerReference: string | null;
  transactionId: string | null;
  responseCode: string | null;
  remoteResponseCode: string | null;
  authorizationCode: string | null;
  retrievalReferenceNumber: string | null;
  transactionToken: string | null;
  maskedCardNumber: string | null;
  paidAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly cardnetGateway: CardnetGateway,
    @Inject(paymentConfig.KEY)
    private readonly paymentsConfig: ConfigType<typeof paymentConfig>,
  ) {}

  list(): Promise<Payment[]> {
    return this.prisma.payment.findMany({
      include: { paymentsTransactions: true, refunds: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({
      where: { id },
      include: { paymentsTransactions: true, refunds: true },
    });
  }

  async create(
    dto: CreatePaymentDto,
    user?: AuthenticatedUser,
  ): Promise<CreatePaymentResult> {
    if (dto.paymentMethod === PAYMENT_METHOD.CORPORATE_CREDIT) {
      if (!user) {
        throw new ForbiddenException({
          code: ERROR_CODES.FORBIDDEN,
          message: 'Authenticated user is required for corporate credit',
        });
      }

      return this.approveCorporateCredit(dto, user);
    }

    if (dto.paymentMethod === PAYMENT_METHOD.CHECK) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Checks must be registered from the portal once received',
      });
    }

    if (dto.paymentMethod !== PAYMENT_METHOD.CARD) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'This payment method is not supported for online checkout',
      });
    }

    const order = await this.prisma.transportOrder.findUnique({
      where: { id: dto.orderId },
      include: {
        customer: { include: { user: { select: SAFE_USER_SELECT } } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    if (
      user?.roles.length === 1 &&
      user.roles[0] === ROLES.CUSTOMER &&
      order.customer.user.id !== user.id
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You cannot create payments for another customer order',
      });
    }

    const amount = order.totalAmount;

    if (amount === null) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Order has no calculated amount available for payment',
      });
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        amount,
        currency: dto.currency?.trim().toUpperCase() ?? 'DOP',
        paymentMethod: dto.paymentMethod,
        paymentProvider: this.providers.get(dto.provider).name,
        status: PAYMENT_STATUS.PENDING,
        providerReference: null,
      },
    });

    const provider = this.providers.get(dto.provider);
    const checkout = await provider.createCheckout({
      paymentId: payment.id,
      orderId: order.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      method: payment.paymentMethod,
      customerId: order.customerId,
      customerEmail: order.customer.billingEmail ?? order.customer.user.email,
      returnUrl: dto.returnUrl,
      cancelUrl: dto.cancelUrl,
    });

    const [updatedPayment, transaction] = await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentProvider: checkout.provider,
          providerReference: checkout.providerReference ?? null,
          status: this.paymentStatusFromCheckout(checkout),
          ...(checkout.status === 'paid' && { paidAt: new Date() }),
        },
      }),
      this.prisma.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          transactionType: PAYMENT_TRANSACTIONS_TYPE.AUTHORIZATION,
          amount: payment.amount,
          status: this.transactionStatusFromCheckout(checkout),
          providerResponse: checkout.rawResponse as Prisma.InputJsonObject,
        },
      }),
    ]);

    await this.prisma.$transaction((tx) =>
      this.syncOrderAfterPayment(tx, updatedPayment),
    );

    return {
      payment: updatedPayment,
      transaction,
      provider: checkout.provider,
      providerReference: checkout.providerReference,
      checkoutUrl: checkout.checkoutUrl,
    };
  }

  async registerCheck(
    dto: RegisterCheckPaymentDto,
    user: AuthenticatedUser,
  ): Promise<CreatePaymentResult> {
    const order = await this.loadPayableOrder(dto.orderId);
    const amount = this.payableAmount(order.totalAmount, dto.amount);
    const receivedAt = dto.receivedAt ?? new Date();
    const providerReference = `check:${dto.bankName.trim()}:${dto.checkNumber.trim()}`;

    this.assertOrderNotAlreadyDispatchable(order);

    const [payment, transaction] = await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            customerId: order.customerId,
            amount,
            currency: 'DOP',
            paymentMethod: PAYMENT_METHOD.CHECK,
            paymentProvider: 'manual-check',
            status: PAYMENT_STATUS.AUTHORIZED,
            checkStatus: CHECK_STATUS.RECEIVED,
            providerReference,
            dispatchAuthorizedAt: receivedAt,
            dispatchAuthorizedBy: user.id,
          },
        });

        const transaction = await tx.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            transactionType: PAYMENT_TRANSACTIONS_TYPE.AUTHORIZATION,
            amount,
            status: PAYMENTS_TRANSACTIONS_STATUS.SUCCESS,
            providerResponse: {
              provider: 'manual-check',
              bankName: dto.bankName.trim(),
              checkNumber: dto.checkNumber.trim(),
              receivedAt: receivedAt.toISOString(),
              notes: 'notes' in dto ? (dto.notes?.trim() ?? null) : null,
            },
          },
        });

        await this.syncOrderAfterPayment(tx, payment);

        return [payment, transaction];
      },
    );

    return {
      payment,
      transaction,
      provider: 'manual-check',
      providerReference,
    };
  }

  async approveCorporateCredit(
    dto: ApproveCorporateCreditPaymentDto | CreatePaymentDto,
    user: AuthenticatedUser,
  ): Promise<CreatePaymentResult> {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: dto.orderId },
      include: {
        customer: {
          include: {
            user: { select: SAFE_USER_SELECT },
            creditAccount: true,
          },
        },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    if (
      user.roles.length === 1 &&
      user.roles[0] === ROLES.CUSTOMER &&
      order.customer.user.id !== user.id
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You cannot approve credit for another customer order',
      });
    }

    if (order.customer.customerType !== TYPE_CUSTOMER.BUSINESS) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Corporate credit is only available for business customers',
      });
    }

    const account = order.customer.creditAccount;

    if (!account || account.status !== CREDIT_ACCOUNT_STATUS.ACTIVE) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Customer does not have active corporate credit',
      });
    }

    this.assertOrderNotAlreadyDispatchable(order);

    const amount = this.payableAmount(order.totalAmount, dto.amount);
    const nextBalance = Number(account.balanceUsed) + amount;

    if (nextBalance > Number(account.creditLimit)) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Corporate credit limit would be exceeded',
      });
    }

    const providerReference = `credit:${order.orderCode}`;
    const [payment, transaction] = await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            customerId: order.customerId,
            amount,
            currency: 'DOP',
            paymentMethod: PAYMENT_METHOD.CORPORATE_CREDIT,
            paymentProvider: 'corporate-credit',
            status: PAYMENT_STATUS.AUTHORIZED,
            providerReference,
            dispatchAuthorizedAt: new Date(),
            dispatchAuthorizedBy: user.id,
          },
        });

        const transaction = await tx.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            transactionType: PAYMENT_TRANSACTIONS_TYPE.AUTHORIZATION,
            amount,
            status: PAYMENTS_TRANSACTIONS_STATUS.SUCCESS,
            providerResponse: {
              provider: 'corporate-credit',
              creditAccountId: account.id,
              creditDays: account.creditDays,
              notes: 'notes' in dto ? (dto.notes?.trim() ?? null) : null,
            },
          },
        });

        await tx.customerCreditAccount.update({
          where: { id: account.id },
          data: { balanceUsed: { increment: amount } },
        });
        await this.syncOrderAfterPayment(tx, payment);

        return [payment, transaction];
      },
    );

    return {
      payment,
      transaction,
      provider: 'corporate-credit',
      providerReference,
    };
  }

  async createCardnetSession(
    orderId: string,
    user: AuthenticatedUser,
    ip: string,
  ): Promise<CreateCardnetSessionResult> {
    const order = await this.prisma.transportOrder.findFirst({
      where: {
        id: orderId,
        customer: { userId: user.id },
      },
      include: {
        customer: {
          include: {
            user: { select: SAFE_USER_SELECT },
            customerAddresses: true,
          },
        },
        orderStops: true,
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    if (
      order.paymentStatus === PAYMENT_STATUS.PAID ||
      order.paymentStatus === PAYMENT_STATUS.AUTHORIZED ||
      order.payments.some((payment) =>
        this.isDispatchAuthorizedPayment(payment),
      )
    ) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Order already has a dispatchable payment',
      });
    }

    if (order.totalAmount === null || Number(order.totalAmount) <= 0) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Order has no payable amount',
      });
    }

    const reusable = order.payments.find(
      (payment) =>
        payment.paymentProvider === 'cardnet' &&
        payment.providerSessionId &&
        payment.providerSessionKey &&
        payment.expiresAt &&
        payment.expiresAt.getTime() > Date.now() &&
        (
          [
            PAYMENT_STATUS.PENDING,
            PAYMENT_STATUS.PROCESSING,
          ] as PAYMENT_STATUS[]
        ).includes(payment.status),
    );

    if (reusable?.providerSessionId && reusable.expiresAt) {
      return {
        paymentId: reusable.id,
        orderId: order.id,
        session: reusable.providerSessionId,
        authorizeUrl: this.requireCardnetAuthorizeUrl(),
        expiresAt: reusable.expiresAt,
      };
    }

    const transactionId = await this.generateTransactionId();
    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        amount: order.totalAmount,
        currency: 'DOP',
        paymentMethod: PAYMENT_METHOD.CARD,
        paymentProvider: 'cardnet',
        status: PAYMENT_STATUS.PENDING,
        providerReference: null,
        transactionId,
      },
    });
    const payload = this.buildCardnetPayload(order, transactionId, ip);

    try {
      const session = await this.cardnetGateway.createSession(payload);
      const expiresAt = new Date(Date.now() + 30 * 60_000);

      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PAYMENT_STATUS.PROCESSING,
            providerReference: session.SESSION,
            providerSessionId: session.SESSION,
            providerSessionKey: session['session-key'],
            sessionCreatedAt: new Date(),
            expiresAt,
          },
        }),
        this.prisma.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            transactionType: PAYMENT_TRANSACTIONS_TYPE.AUTHORIZATION,
            amount: payment.amount,
            status: PAYMENTS_TRANSACTIONS_STATUS.PENDING,
            providerResponse: {
              provider: 'cardnet',
              session: session.SESSION,
            },
          },
        }),
      ]);

      return {
        paymentId: payment.id,
        orderId: order.id,
        session: session.SESSION,
        authorizeUrl: this.requireCardnetAuthorizeUrl(),
        expiresAt,
      };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PAYMENT_STATUS.FAILED },
      });

      throw error;
    }
  }

  async verifyCardnetPayment(
    paymentId: string,
    user: AuthenticatedUser,
  ): Promise<PaymentReceiptResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: { include: { customer: true } } },
    });

    if (!payment) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Payment not found',
      });
    }

    this.assertCanReadPayment(payment, user);

    if (!payment.providerSessionId) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Payment has no CardNET session',
      });
    }

    return this.verifyCardnetPaymentBySession(payment.providerSessionId);
  }

  async verifyCardnetPaymentBySession(
    session: string,
  ): Promise<PaymentReceiptResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { providerSessionId: session },
      include: {
        order: { include: { customer: true } },
        paymentsTransactions: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!payment) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'No payment is associated with this CardNET session',
      });
    }

    if (payment.status === PAYMENT_STATUS.PAID) {
      return this.toReceipt(payment);
    }

    if (!payment.providerSessionKey) {
      throw new BadGatewayException('CardNET session key is missing');
    }

    const result = await this.cardnetGateway.getResult(
      session,
      payment.providerSessionKey,
    );
    const resultOrderId = this.pickString(
      result,
      'OrdenID',
      'OrdenId',
      'orderId',
    );
    const resultTransactionId = this.pickString(
      result,
      'TransactionID',
      'TransactionId',
      'transactionId',
    );

    if (resultOrderId && resultOrderId !== payment.order.orderCode) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'CardNET returned a different order',
      });
    }

    if (
      resultTransactionId &&
      payment.transactionId &&
      resultTransactionId !== payment.transactionId
    ) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'CardNET returned a different transaction',
      });
    }

    const responseCode = this.pickString(
      result,
      'ResponseCode',
      'responseCode',
      'RemoteResponseCode',
      'remoteResponseCode',
    );
    const status = this.paymentStatusFromCardnetResponse(responseCode);
    const verifiedAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status,
          responseCode: responseCode ?? null,
          remoteResponseCode:
            this.pickString(
              result,
              'RemoteResponseCode',
              'remoteResponseCode',
            ) ?? null,
          authorizationCode:
            this.pickString(result, 'AuthorizationCode', 'authorizationCode') ??
            null,
          retrievalReferenceNumber:
            this.pickString(
              result,
              'RetrivalReferenceNumber',
              'RetrievalReferenceNumber',
              'retrievalReferenceNumber',
            ) ?? null,
          transactionToken:
            this.pickString(result, 'TxToken', 'txToken') ?? null,
          maskedCardNumber:
            this.pickString(
              result,
              'CreditCardNumber',
              'CreditcardNumber',
              'creditCardNumber',
            ) ?? null,
          verifiedAt,
          ...(status === PAYMENT_STATUS.PAID && { paidAt: verifiedAt }),
        },
      });

      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          transactionType: PAYMENT_TRANSACTIONS_TYPE.CAPTURE,
          amount: payment.amount,
          status: this.transactionStatusFromPaymentStatus(status),
          providerResponse: result as Prisma.InputJsonObject,
        },
      });

      await this.syncOrderAfterPayment(tx, { ...payment, status });

      return updatedPayment;
    });

    return this.toReceipt({ ...payment, ...updated });
  }

  async cancelCardnetPaymentBySession(
    session: string,
  ): Promise<PaymentReceiptResult | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { providerSessionId: session },
      include: { order: { include: { customer: true } } },
    });

    if (!payment) {
      return null;
    }

    if (payment.status === PAYMENT_STATUS.PAID) {
      return this.toReceipt(payment);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PAYMENT_STATUS.CANCELLED,
          verifiedAt: new Date(),
        },
      });

      await tx.transportOrder.update({
        where: { id: payment.orderId },
        data: { paymentStatus: PAYMENT_STATUS.PENDING },
      });

      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          transactionType: PAYMENT_TRANSACTIONS_TYPE.VOID,
          amount: payment.amount,
          status: PAYMENTS_TRANSACTIONS_STATUS.FAILED,
          providerResponse: {
            provider: 'cardnet',
            session,
            status: 'cancelled_by_customer',
          },
        },
      });

      return updatedPayment;
    });

    return this.toReceipt({ ...payment, ...updated });
  }

  async getReceipt(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PaymentReceiptResult> {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        order: { include: { customer: true } },
        paymentsTransactions: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!payment) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Payment not found',
      });
    }

    this.assertCanReadPayment(payment, user);

    return this.toReceipt(payment);
  }

  customerPaymentUrl(
    path: string,
    params: Record<string, string | undefined>,
  ): string {
    const url = new URL(path, this.paymentsConfig.customerAppBaseUrl);

    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  updateStatus(id: string, dto: UpdatePaymentStatusDto): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { id },
        select: { paymentMethod: true },
      });
      const payment = await tx.payment.update({
        where: { id },
        data: {
          status: dto.status,
          providerReference: dto.providerReference ?? undefined,
          ...(dto.status === PAYMENT_STATUS.PAID && { paidAt: new Date() }),
          ...(dto.status === PAYMENT_STATUS.PAID &&
            existing?.paymentMethod === PAYMENT_METHOD.CHECK && {
              checkStatus: CHECK_STATUS.CLEARED,
            }),
        },
      });

      await this.syncOrderAfterPayment(tx, payment);

      return payment;
    });
  }

  private async loadPayableOrder(orderId: string) {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: orderId },
      include: { payments: { orderBy: { createdAt: 'desc' } } },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    return order;
  }

  private payableAmount(totalAmount: unknown, override?: number): number {
    const amount = override ?? Number(totalAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Order has no payable amount',
      });
    }

    return amount;
  }

  private assertOrderNotAlreadyDispatchable(order: {
    paymentStatus: PAYMENT_STATUS;
    payments: { status: PAYMENT_STATUS; paymentMethod: PAYMENT_METHOD }[];
  }): void {
    const hasDispatchablePayment = order.payments.some((payment) =>
      this.isDispatchAuthorizedPayment(payment),
    );

    if (
      order.paymentStatus === PAYMENT_STATUS.PAID ||
      order.paymentStatus === PAYMENT_STATUS.AUTHORIZED ||
      hasDispatchablePayment
    ) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Order already has a dispatchable payment',
      });
    }
  }

  private async syncOrderAfterPayment(
    tx: Prisma.TransactionClient,
    payment: Pick<Payment, 'orderId' | 'paymentMethod' | 'status'>,
  ): Promise<void> {
    const order = await tx.transportOrder.findUnique({
      where: { id: payment.orderId },
      select: { status: true },
    });

    const dispatchAuthorized = this.isDispatchAuthorizedPayment(payment);
    const nextPaymentStatus = dispatchAuthorized
      ? payment.status
      : payment.status === PAYMENT_STATUS.FAILED ||
          payment.status === PAYMENT_STATUS.CANCELLED ||
          payment.status === PAYMENT_STATUS.EXPIRED
        ? PAYMENT_STATUS.PENDING
        : payment.status;

    await tx.transportOrder.update({
      where: { id: payment.orderId },
      data: {
        paymentStatus: nextPaymentStatus,
        ...(dispatchAuthorized &&
          order &&
          ORDER_STATUSES_AWAITING_PAYMENT.has(order.status) && {
            status: STATUS_ORDERS.REQUESTED,
          }),
      },
    });
  }

  private isDispatchAuthorizedPayment(
    payment: Pick<Payment, 'paymentMethod' | 'status'>,
  ): boolean {
    if (payment.status === PAYMENT_STATUS.PAID) {
      return true;
    }

    return (
      payment.status === PAYMENT_STATUS.AUTHORIZED &&
      DISPATCHABLE_MANUAL_METHODS.has(payment.paymentMethod)
    );
  }

  private buildCardnetPayload(
    order: CardnetOrder,
    transactionId: string,
    ip: string,
  ): Record<string, string> {
    this.assertCardnetConfig();

    const user = order.customer.user;
    const email = order.customer.billingEmail ?? user.email;
    const phone = this.normalizedPhone(user.phone);
    const billingAddress = this.billingAddressForOrder(order);

    if (!email) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Customer billing email is required for CardNET 3DS',
      });
    }

    return {
      TransactionType: this.paymentsConfig.cardnetTransactionType,
      CurrencyCode: this.paymentsConfig.cardnetCurrencyCode,
      AcquiringInstitutionCode: this.paymentsConfig.cardnetAcquirerCode,
      MerchantType: this.paymentsConfig.cardnetMerchantType,
      MerchantNumber: this.paymentsConfig.cardnetMerchantNumber,
      MerchantTerminal: this.paymentsConfig.cardnetTerminal,
      MerchantTerminal_amex: this.paymentsConfig.cardnetTerminalAmex,
      ReturnUrl: this.cardnetReturnUrl(),
      CancelUrl: this.cardnetCancelUrl(),
      PageLanguaje: this.paymentsConfig.cardnetPageLanguage,
      OrdenId: order.orderCode,
      TransactionId: transactionId,
      Tax: this.formatCardnetAmount(this.paymentsConfig.cardnetTaxAmount, true),
      Amount: this.formatCardnetAmount(order.totalAmount),
      MerchantName: this.paymentsConfig.cardnetMerchantName,
      Ipclient: ip || '127.0.0.1',
      '3DS_email': email,
      '3DS_mobilePhone': phone,
      '3DS_workPhone': phone,
      '3DS_homePhone': phone,
      '3DS_billAddr_line1': billingAddress.addressLine,
      '3DS_billAddr_line2': ' ',
      '3DS_billAddr_line3': ' ',
      '3DS_billAddr_city': billingAddress.city,
      '3DS_billAddr_state': billingAddress.province,
      '3DS_billAddr_country':
        billingAddress.countryCode ??
        this.paymentsConfig.cardnetBillingCountryCode,
      '3DS_billAddr_postCode':
        billingAddress.postalCode ??
        this.paymentsConfig.cardnetBillingPostalCode,
    };
  }

  private billingAddressForOrder(order: CardnetOrder): {
    addressLine: string;
    city: string;
    province: string;
    countryCode?: string | null;
    postalCode?: string | null;
  } {
    const savedAddress =
      order.customer.customerAddresses.find((address) => address.isDefault) ??
      order.customer.customerAddresses[0];

    if (savedAddress) {
      return {
        addressLine: savedAddress.addressesLine,
        city: savedAddress.city,
        province: savedAddress.province,
        countryCode: savedAddress.countryCode,
        postalCode: savedAddress.postalCode,
      };
    }

    const pickup =
      order.orderStops.find((stop) => stop.stopType === STOP_TYPE.PICKUP) ??
      order.orderStops[0];

    if (!pickup) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Billing address is required for CardNET 3DS',
      });
    }

    return {
      addressLine: pickup.addressLine,
      city: pickup.city,
      province: pickup.province,
      countryCode: null,
      postalCode: null,
    };
  }

  private assertCardnetConfig(): void {
    const missing = [
      ['CARDNET_SESSION_URL', this.paymentsConfig.cardnetSessionUrl],
      ['CARDNET_AUTHORIZE_URL', this.paymentsConfig.cardnetAuthorizeUrl],
      ['CARDNET_MERCHANT_NUMBER', this.paymentsConfig.cardnetMerchantNumber],
      ['CARDNET_TERMINAL', this.paymentsConfig.cardnetTerminal],
      ['CARDNET_MERCHANT_TYPE', this.paymentsConfig.cardnetMerchantType],
      ['CARDNET_ACQUIRER_CODE', this.paymentsConfig.cardnetAcquirerCode],
      ['CARDNET_MERCHANT_NAME', this.paymentsConfig.cardnetMerchantName],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (!this.cardnetReturnUrl(false)) {
      missing.push('CARDNET_RETURN_URL or PAYMENT_CALLBACK_BASE_URL');
    }

    if (!this.cardnetCancelUrl(false)) {
      missing.push('CARDNET_CANCEL_URL or PAYMENT_CALLBACK_BASE_URL');
    }

    if (missing.length > 0) {
      throw new BadGatewayException(
        `CardNET configuration is incomplete: ${missing.join(', ')}`,
      );
    }
  }

  private requireCardnetAuthorizeUrl(): string {
    const url = this.paymentsConfig.cardnetAuthorizeUrl;

    if (!url) {
      throw new BadGatewayException('CARDNET_AUTHORIZE_URL is not configured');
    }

    return url;
  }

  private cardnetReturnUrl(throwOnMissing = true): string {
    const configured = this.paymentsConfig.cardnetReturnUrl;

    if (configured) {
      return configured;
    }

    if (this.paymentsConfig.callbackBaseUrl) {
      return `${this.paymentsConfig.callbackBaseUrl.replace(/\/$/, '')}/payments/cardnet/return`;
    }

    if (throwOnMissing) {
      throw new BadGatewayException('CARDNET_RETURN_URL is not configured');
    }

    return '';
  }

  private cardnetCancelUrl(throwOnMissing = true): string {
    const configured = this.paymentsConfig.cardnetCancelUrl;

    if (configured) {
      return configured;
    }

    if (this.paymentsConfig.callbackBaseUrl) {
      return `${this.paymentsConfig.callbackBaseUrl.replace(/\/$/, '')}/payments/cardnet/cancel`;
    }

    if (throwOnMissing) {
      throw new BadGatewayException('CARDNET_CANCEL_URL is not configured');
    }

    return '';
  }

  private normalizedPhone(value: string | null | undefined): string {
    const phone = value?.replace(/\D/g, '') ?? '';

    if (phone.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Customer phone is required for CardNET 3DS',
      });
    }

    return phone;
  }

  private formatCardnetAmount(value: unknown, allowZero = false): string {
    const amount = Number(value);

    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      (!allowZero && amount === 0)
    ) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Invalid CardNET amount',
      });
    }

    const cents = Math.round(amount * 100);

    return String(cents).padStart(12, '0');
  }

  private async generateTransactionId(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const transactionId = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const existing = await this.prisma.payment.findFirst({
        where: { paymentProvider: 'cardnet', transactionId },
        select: { id: true },
      });

      if (!existing) {
        return transactionId;
      }
    }

    throw new ConflictException({
      code: ERROR_CODES.RESOURCE_CONFLICT,
      message: 'Could not generate a unique CardNET transaction id',
    });
  }

  private paymentStatusFromCardnetResponse(
    responseCode?: string,
  ): PAYMENT_STATUS {
    switch (responseCode) {
      case '00':
        return PAYMENT_STATUS.PAID;
      case '09':
        return PAYMENT_STATUS.PROCESSING;
      default:
        return PAYMENT_STATUS.FAILED;
    }
  }

  private transactionStatusFromPaymentStatus(
    status: PAYMENT_STATUS,
  ): PAYMENTS_TRANSACTIONS_STATUS {
    switch (status) {
      case PAYMENT_STATUS.PAID:
        return PAYMENTS_TRANSACTIONS_STATUS.SUCCESS;
      case PAYMENT_STATUS.PROCESSING:
      case PAYMENT_STATUS.PENDING:
        return PAYMENTS_TRANSACTIONS_STATUS.PENDING;
      default:
        return PAYMENTS_TRANSACTIONS_STATUS.FAILED;
    }
  }

  private paymentStatusFromCheckout(
    checkout: PaymentCheckoutResult,
  ): PAYMENT_STATUS {
    switch (checkout.status) {
      case 'authorized':
        return PAYMENT_STATUS.AUTHORIZED;
      case 'paid':
        return PAYMENT_STATUS.PAID;
      case 'failed':
        return PAYMENT_STATUS.FAILED;
      default:
        return PAYMENT_STATUS.PENDING;
    }
  }

  private transactionStatusFromCheckout(
    checkout: PaymentCheckoutResult,
  ): PAYMENTS_TRANSACTIONS_STATUS {
    switch (checkout.status) {
      case 'authorized':
      case 'paid':
        return PAYMENTS_TRANSACTIONS_STATUS.SUCCESS;
      case 'failed':
        return PAYMENTS_TRANSACTIONS_STATUS.FAILED;
      default:
        return PAYMENTS_TRANSACTIONS_STATUS.PENDING;
    }
  }

  private pickString(
    payload: Record<string, unknown>,
    ...keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const value = optionalString(payload[key]);

      if (value) {
        return value;
      }
    }

    return undefined;
  }

  private assertCanReadPayment(
    payment: PaymentWithOrder,
    user: AuthenticatedUser,
  ) {
    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      return;
    }

    if (payment.order.customer?.userId === user.id) {
      return;
    }

    throw new ForbiddenException({
      code: ERROR_CODES.FORBIDDEN,
      message: 'You cannot access this payment',
    });
  }

  private toReceipt(payment: PaymentWithOrder | Payment): PaymentReceiptResult {
    const order = 'order' in payment ? payment.order : undefined;

    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      orderCode: order?.orderCode,
      status: payment.status,
      amount: Number(payment.amount),
      currency: payment.currency,
      provider: payment.paymentProvider,
      providerReference: payment.providerReference,
      transactionId: payment.transactionId,
      responseCode: payment.responseCode,
      remoteResponseCode: payment.remoteResponseCode,
      authorizationCode: payment.authorizationCode,
      retrievalReferenceNumber: payment.retrievalReferenceNumber,
      transactionToken: payment.transactionToken,
      maskedCardNumber: payment.maskedCardNumber,
      paidAt: payment.paidAt,
      verifiedAt: payment.verifiedAt,
      createdAt: payment.createdAt,
    };
  }
}
