import type { PrismaService } from '@/database/prisma.service';
import { HealthController } from './health.controller';

function setup(queryRaw: jest.Mock) {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return { controller: new HealthController(prisma), queryRaw };
}

describe('HealthController', () => {
  it('liveness never touches the database (lets Neon scale to zero)', () => {
    const { controller, queryRaw } = setup(jest.fn());

    expect(controller.check().status).toBe('ok');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('readiness reports the database', async () => {
    const { controller } = setup(jest.fn().mockResolvedValue([1]));

    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ok',
      database: 'up',
    });
  });

  it('readiness is degraded when the database is down', async () => {
    const { controller } = setup(
      jest.fn().mockRejectedValue(new Error('down')),
    );

    await expect(controller.ready()).resolves.toMatchObject({
      status: 'degraded',
      database: 'down',
    });
  });
});
