import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { paymentConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

// El primer test paga la carga en frio de PaymentsService y sus imports.
jest.setTimeout(30_000);

const SESSION = 'sess-123';
const SECRET = 'whsec-test';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

async function createApp(secrets: {
  cardnetWebhookSecret?: string;
  azulWebhookSecret?: string;
}) {
  const prisma = {
    payment: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    transportOrder: { update: jest.fn(), updateMany: jest.fn() },
    webhookEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      update: jest.fn().mockResolvedValue({ id: 'evt-1' }),
    },
    $transaction: jest.fn(),
  };
  const payments = {
    verifyCardnetPaymentBySession: jest.fn(),
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [WebhooksController],
    providers: [
      WebhooksService,
      { provide: PrismaService, useValue: prisma },
      { provide: PaymentsService, useValue: payments },
      {
        provide: paymentConfig.KEY,
        useValue: {
          cardnetWebhookSecret: secrets.cardnetWebhookSecret ?? '',
          azulWebhookSecret: secrets.azulWebhookSecret ?? '',
        },
      },
    ],
  }).compile();
  const app: INestApplication<App> = moduleRef.createNestApplication({
    logger: false,
    rawBody: true,
  });
  await app.init();

  return { app, prisma, payments };
}

describe('WebhooksController (SEC-API-001)', () => {
  let app: INestApplication<App> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('ignores a forged "approved" payload: no payment is touched', async () => {
    const ctx = await createApp({});
    app = ctx.app;

    const res = await request(app.getHttpServer())
      .post('/webhooks/cardnet')
      .send({ OrdenID: 'ORD-1', status: 'approved', id: 'x1' })
      .expect(200);

    expect(res.body).toEqual({ received: true, processed: false });
    expect(ctx.payments.verifyCardnetPaymentBySession).not.toHaveBeenCalled();
    expect(ctx.prisma.payment.update).not.toHaveBeenCalled();
    expect(ctx.prisma.transportOrder.updateMany).not.toHaveBeenCalled();
    expect(ctx.prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('takes the status from CardNET, not from the body', async () => {
    const ctx = await createApp({});
    app = ctx.app;
    ctx.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      paymentProvider: 'cardnet',
    });
    ctx.payments.verifyCardnetPaymentBySession.mockResolvedValue({
      status: 'FAILED',
    });

    const res = await request(app.getHttpServer())
      .post('/webhooks/cardnet')
      .send({ SESSION, status: 'approved', ResponseCode: '00' })
      .expect(200);

    expect(ctx.payments.verifyCardnetPaymentBySession).toHaveBeenCalledWith(
      SESSION,
    );
    expect(res.body).toEqual({
      received: true,
      processed: true,
      paymentStatus: 'FAILED',
    });
    expect(ctx.prisma.payment.update).not.toHaveBeenCalled();
  });

  it('drops unknown sessions without writing', async () => {
    const ctx = await createApp({});
    app = ctx.app;
    ctx.prisma.payment.findUnique.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post('/webhooks/cardnet')
      .send({ SESSION: 'nope', status: 'approved' })
      .expect(200);

    expect(ctx.prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(ctx.payments.verifyCardnetPaymentBySession).not.toHaveBeenCalled();
  });

  it('rejects a bad signature when CARDNET_WEBHOOK_SECRET is set', async () => {
    const ctx = await createApp({ cardnetWebhookSecret: SECRET });
    app = ctx.app;
    const body = JSON.stringify({ SESSION, status: 'approved' });

    await request(app.getHttpServer())
      .post('/webhooks/cardnet')
      .set('content-type', 'application/json')
      .set('x-cardnet-signature', sign(body, 'wrong'))
      .send(body)
      .expect(401);

    await request(app.getHttpServer())
      .post('/webhooks/cardnet')
      .send({ SESSION, status: 'approved' })
      .expect(401);

    expect(ctx.prisma.payment.findUnique).not.toHaveBeenCalled();
    expect(ctx.payments.verifyCardnetPaymentBySession).not.toHaveBeenCalled();
  });

  it('accepts a valid signature over the raw body', async () => {
    const ctx = await createApp({ cardnetWebhookSecret: SECRET });
    app = ctx.app;
    ctx.prisma.payment.findUnique.mockResolvedValue({
      id: 'pay-1',
      paymentProvider: 'cardnet',
    });
    ctx.payments.verifyCardnetPaymentBySession.mockResolvedValue({
      status: 'PAID',
    });
    const body = JSON.stringify({ SESSION, id: 'evt-cn-1' });

    await request(app.getHttpServer())
      .post('/webhooks/cardnet')
      .set('content-type', 'application/json')
      .set('x-cardnet-signature', `sha256=${sign(body)}`)
      .send(body)
      .expect(200);

    expect(ctx.payments.verifyCardnetPaymentBySession).toHaveBeenCalledWith(
      SESSION,
    );
    const [createArgs] = ctx.prisma.webhookEvent.create.mock.calls[0] as [
      { data: { payload: { signatureVerified: boolean } } },
    ];
    expect(createArgs.data.payload.signatureVerified).toBe(true);
  });

  it('rejects Azul webhooks when no secret is configured', async () => {
    const ctx = await createApp({});
    app = ctx.app;

    await request(app.getHttpServer())
      .post('/webhooks/azul')
      .send({ paymentId: 'pay-1', status: 'approved' })
      .expect(401);

    expect(ctx.prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('records signed Azul webhooks without changing payment state', async () => {
    const ctx = await createApp({ azulWebhookSecret: SECRET });
    app = ctx.app;
    const body = JSON.stringify({ paymentId: 'pay-1', status: 'approved' });

    const res = await request(app.getHttpServer())
      .post('/webhooks/azul')
      .set('content-type', 'application/json')
      .set('x-azul-signature', sign(body))
      .send(body)
      .expect(200);

    expect(res.body).toEqual({ received: true, processed: false });
    expect(ctx.prisma.webhookEvent.create).toHaveBeenCalled();
    expect(ctx.prisma.payment.update).not.toHaveBeenCalled();
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
  });
});
