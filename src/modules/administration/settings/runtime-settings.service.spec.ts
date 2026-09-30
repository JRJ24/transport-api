import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { demandConfig, matchingConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import { RuntimeSettingsService } from './runtime-settings.service';

function setup(rows: { key: string; value: string; valueType: string }[] = []) {
  let stored = rows.map((row) => ({
    ...row,
    updatedAt: new Date('2026-09-30T10:00:00Z'),
    user: { fullName: 'Admin' },
  }));
  const prisma = {
    systemParameter: {
      findMany: jest.fn(() => Promise.resolve(stored)),
      upsert: jest.fn(
        ({
          create,
        }: {
          create: { key: string; value: string; valueType: string };
        }) => {
          stored = [
            ...stored.filter((row) => row.key !== create.key),
            { ...create, updatedAt: new Date(), user: { fullName: 'Admin' } },
          ];
          return {};
        },
      ),
    },
    auditLog: { create: jest.fn().mockReturnValue({}) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  const service = new RuntimeSettingsService(
    prisma,
    { autoOffer: 'off', offerTtlSec: 30, maxRings: 3 } as ReturnType<
      typeof matchingConfig
    >,
    { mode: 'shadow' } as ReturnType<typeof demandConfig>,
  );
  return { service, prisma };
}

describe('RuntimeSettingsService', () => {
  it('falls back to the environment when nothing is stored', async () => {
    const { service } = setup();
    await service.refresh();

    expect(service.get('matching.auto_offer')).toBe(false);
    expect(service.get('matching.offer_ttl_sec')).toBe(30);
    expect(service.get('pricing.demand.mode')).toBe('shadow');
    expect(service.get('tax.rate')).toBe(0.18);
  });

  it('uses the stored value once an administrator changed it', async () => {
    const { service } = setup([
      { key: 'matching.auto_offer', value: 'true', valueType: 'BOOLEAN' },
      {
        key: 'matching.score.weights',
        value: '{"eta":0.7,"distance":0.1,"reliability":0.1,"balance":0.1}',
        valueType: 'JSON',
      },
    ]);
    await service.refresh();

    expect(service.get('matching.auto_offer')).toBe(true);
    expect(service.get('matching.score.weights').eta).toBe(0.7);
    expect(
      service.list().find((row) => row.key === 'matching.auto_offer')?.source,
    ).toBe('database');
  });

  it('ignores a stored value that no longer validates', async () => {
    const { service } = setup([
      { key: 'tax.rate', value: '5', valueType: 'NUMBER' },
    ]);
    await service.refresh();

    expect(service.get('tax.rate')).toBe(0.18);
  });

  it('validates, stores, audits and applies an update immediately', async () => {
    const { service, prisma } = setup();
    await service.refresh();

    const view = await service.update('admin-1', 'matching.offer_ttl_sec', 45);

    expect(view.value).toBe(45);
    expect(service.get('matching.offer_ttl_sec')).toBe(45);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'SYSTEM_PARAMETER_UPDATED',
          entityId: 'matching.offer_ttl_sec',
        }),
      }),
    );
  });

  it('rejects invalid values and unknown keys', async () => {
    const { service } = setup();

    await expect(
      service.update('admin-1', 'matching.offer_ttl_sec', 2),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('admin-1', 'pricing.demand.mode', 'maybe'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('admin-1', 'secret.key', 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
