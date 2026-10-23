import { createHmac } from 'node:crypto';
import type { ConfigType } from '@nestjs/config';
import type { paymentConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import type { PaymentsService } from '../payments/payments.service';
import { WebhooksService } from './webhooks.service';

const SECRET = 'azul-secret';

function setup(create: jest.Mock) {
  const prisma = { webhookEvent: { create, findFirst: jest.fn() } };
  const service = new WebhooksService(
    prisma as unknown as PrismaService,
    {} as PaymentsService,
    { azulWebhookSecret: SECRET } as ConfigType<typeof paymentConfig>,
  );
  return { service, prisma };
}

/** Delivers a signed Azul webhook with this exact body. */
function deliver(service: WebhooksService, body: string) {
  const rawBody = Buffer.from(body);
  const signature = createHmac('sha256', SECRET).update(rawBody).digest('hex');
  return service.receiveProvider(
    'azul',
    JSON.parse(body) as Record<string, unknown>,
    signature,
    rawBody,
  );
}

const createdIds = (create: jest.Mock): string[] =>
  create.mock.calls.map(
    ([args]) =>
      (args as { data: { externalEventId: string } }).data.externalEventId,
  );

describe('WebhooksService delivery idempotency (FIA-API-004)', () => {
  it('acknowledges a delivery that is already stored (unique violation)', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    const { service } = setup(create);

    await expect(deliver(service, '{"id":"evt-1"}')).resolves.toEqual({
      received: true,
      processed: false,
    });
  });

  it('derives the same id from the same body when the payload has none', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'row' });
    const { service } = setup(create);

    await deliver(service, '{"status":"approved","amount":10}');
    await deliver(service, '{"status":"approved","amount":10}');

    const [first, second] = createdIds(create);
    expect(first).toMatch(/^azul:body-[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it('derives different ids from different bodies', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'row' });
    const { service } = setup(create);

    await deliver(service, '{"status":"approved","amount":10}');
    await deliver(service, '{"status":"approved","amount":11}');

    const [first, second] = createdIds(create);
    expect(second).not.toBe(first);
  });

  it('inserts directly instead of looking the delivery up first', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'row' });
    const { service, prisma } = setup(create);

    await deliver(service, '{"id":"evt-2"}');

    expect(prisma.webhookEvent.findFirst).not.toHaveBeenCalled();
    expect(createdIds(create)).toEqual(['azul:evt-2']);
  });
});
