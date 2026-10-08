import { Prisma } from '@generated/prisma/client';
import { DeviceTokensService } from './device-tokens.service';
import type { PrismaService } from '@/database/prisma.service';

function makePrisma() {
  // The interactive transaction gets its own client so a register() write
  // that escapes the tx (this.prisma instead of tx) fails the tests.
  const tx = {
    deviceToken: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: 'd1', token: 'tok' }),
    },
  };
  const prisma = {
    deviceToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: 'root', token: 'tok' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  return { prisma, tx };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const dto = {
  token: 'fcm-token-123',
  platform: 'ANDROID' as const,
  installationId: 'install-1',
};

describe('DeviceTokensService', () => {
  it('registers a token via upsert keyed by user + installation inside the transaction', async () => {
    const { prisma, tx } = makePrisma();
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await service.register('user-1', dto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.deviceToken.upsert).toHaveBeenCalledTimes(1);
    const arg = tx.deviceToken.upsert.mock.calls[0][0];
    expect(arg.where.user_installation).toEqual({
      userId: 'user-1',
      installationId: 'install-1',
    });
    expect(arg.create).toMatchObject({
      userId: 'user-1',
      token: 'fcm-token-123',
      installationId: 'install-1',
      isActive: true,
    });
    // No write may run on the root client: it would escape the transaction.
    expect(prisma.deviceToken.deleteMany).not.toHaveBeenCalled();
    expect(prisma.deviceToken.upsert).not.toHaveBeenCalled();
    // The old code only flagged other rows inactive and left the token taken.
    expect(prisma.deviceToken.updateMany).not.toHaveBeenCalled();
  });

  it('frees the token from any other user/installation before the upsert (second driver on the same phone)', async () => {
    const { prisma, tx } = makePrisma();
    const order: string[] = [];
    tx.deviceToken.deleteMany.mockImplementation(() => {
      order.push('deleteMany');
      return Promise.resolve({ count: 1 });
    });
    tx.deviceToken.upsert.mockImplementation(() => {
      order.push('upsert');
      return Promise.resolve({ id: 'd2', token: 'fcm-token-123' });
    });
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await expect(service.register('user-2', dto)).resolves.toEqual({
      id: 'd2',
      token: 'fcm-token-123',
    });

    // NOT over both fields keeps this user's own row for this installation.
    expect(tx.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: {
        token: 'fcm-token-123',
        NOT: { userId: 'user-2', installationId: 'install-1' },
      },
    });
    expect(order).toEqual(['deleteMany', 'upsert']);
  });

  it('replaces the token in place when the same installation re-registers a new one', async () => {
    const { prisma, tx } = makePrisma();
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await service.register('user-1', { ...dto, token: 'fcm-token-refreshed' });

    expect(tx.deviceToken.deleteMany).toHaveBeenCalledWith({
      where: {
        token: 'fcm-token-refreshed',
        NOT: { userId: 'user-1', installationId: 'install-1' },
      },
    });
    const arg = tx.deviceToken.upsert.mock.calls[0][0];
    expect(arg.where.user_installation).toEqual({
      userId: 'user-1',
      installationId: 'install-1',
    });
    expect(arg.update).toMatchObject({
      token: 'fcm-token-refreshed',
      isActive: true,
      failureCount: 0,
    });
  });

  it('retries the transaction once when a concurrent register hits the unique index', async () => {
    const { prisma, tx } = makePrisma();
    tx.deviceToken.upsert
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce({ id: 'd1', token: 'fcm-token-123' });
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await expect(service.register('user-1', dto)).resolves.toEqual({
      id: 'd1',
      token: 'fcm-token-123',
    });
    // The retry is a fresh transaction that frees the token again.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.deviceToken.deleteMany).toHaveBeenCalledTimes(2);
    expect(tx.deviceToken.upsert).toHaveBeenCalledTimes(2);
  });

  it('also retries once on a transaction write conflict (P2034)', async () => {
    const { prisma, tx } = makePrisma();
    tx.deviceToken.deleteMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await expect(service.register('user-1', dto)).resolves.toEqual({
      id: 'd1',
      token: 'tok',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up after one retry so a persistent conflict still surfaces (409 via the Prisma filter)', async () => {
    const { prisma, tx } = makePrisma();
    tx.deviceToken.upsert.mockRejectedValue(p2002());
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await expect(service.register('user-1', dto)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated errors', async () => {
    const { prisma, tx } = makePrisma();
    tx.deviceToken.upsert.mockRejectedValue(new Error('db down'));
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await expect(service.register('user-1', dto)).rejects.toThrow('db down');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('only deactivates the caller own token at logout', async () => {
    const { prisma } = makePrisma();
    prisma.deviceToken.updateMany.mockResolvedValue({ count: 1 });
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await expect(
      service.deactivate('user-1', 'fcm-token-123'),
    ).resolves.toEqual({ count: 1 });
    expect(prisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', token: 'fcm-token-123' },
      data: { isActive: false },
    });
  });

  it('deactivates invalid tokens reported by FCM', async () => {
    const { prisma } = makePrisma();
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await service.deactivateInvalid(['bad-1', 'bad-2']);

    expect(prisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { token: { in: ['bad-1', 'bad-2'] } },
      data: { isActive: false },
    });
  });

  it('no-ops when there are no invalid tokens', async () => {
    const { prisma } = makePrisma();
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await service.deactivateInvalid([]);

    expect(prisma.deviceToken.updateMany).not.toHaveBeenCalled();
  });
});
