import { NOTIFICATION_TYPE } from '@generated/prisma/enums';
import type { PrismaService } from '@/database/prisma.service';
import { NotificationPreferencesService } from './notification-preferences.service';

function setup(
  rows: { category: NOTIFICATION_TYPE; push: boolean; email: boolean }[] = [],
) {
  const prisma = {
    notificationPreference: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn(
        ({ where }: { where: { userId_category: { category: string } } }) =>
          Promise.resolve(
            rows.find(
              (row) => row.category === where.userId_category.category,
            ) ?? null,
          ),
      ),
      upsert: jest.fn().mockReturnValue({}),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  return { service: new NotificationPreferencesService(prisma), prisma };
}

describe('NotificationPreferencesService', () => {
  it('lists every category, on by default, with the critical ones locked', async () => {
    const { service } = setup();

    const list = await service.list('user-1');

    expect(list).toHaveLength(Object.values(NOTIFICATION_TYPE).length);
    expect(list.every((item) => item.push)).toBe(true);
    expect(list.find((item) => item.category === 'ORDER_UPDATE')?.locked).toBe(
      true,
    );
    expect(list.find((item) => item.category === 'PROMOTION')?.locked).toBe(
      false,
    );
  });

  it('blocks push only where the user muted it', async () => {
    const { service } = setup([
      { category: NOTIFICATION_TYPE.PROMOTION, push: false, email: true },
    ]);

    expect(
      await service.allowsPush('user-1', NOTIFICATION_TYPE.PROMOTION),
    ).toBe(false);
    expect(await service.allowsPush('user-1', NOTIFICATION_TYPE.INCIDENT)).toBe(
      true,
    );
  });

  it('never lets order, payment or system push be switched off', async () => {
    const { service, prisma } = setup([
      { category: NOTIFICATION_TYPE.PAYMENT, push: false, email: true },
    ]);

    expect(await service.allowsPush('user-1', NOTIFICATION_TYPE.PAYMENT)).toBe(
      true,
    );
    await service.update('user-1', [
      { category: NOTIFICATION_TYPE.ORDER_UPDATE, push: false },
    ]);
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ push: true }),
        create: expect.objectContaining({ push: true }),
      }),
    );
  });
});
