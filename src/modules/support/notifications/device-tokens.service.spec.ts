import { DeviceTokensService } from './device-tokens.service';
import type { PrismaService } from '@/database/prisma.service';

function makePrisma() {
  return {
    deviceToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({ id: 'd1', token: 'tok' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('DeviceTokensService', () => {
  it('registers a token via upsert keyed by user + installation', async () => {
    const prisma = makePrisma();
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await service.register('user-1', {
      token: 'fcm-token-123',
      platform: 'ANDROID',
      installationId: 'install-1',
    });

    expect(prisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { token: 'fcm-token-123', NOT: { userId: 'user-1' } },
      data: { isActive: false },
    });
    expect(prisma.deviceToken.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.deviceToken.upsert.mock.calls[0][0];
    expect(arg.where.user_installation).toEqual({
      userId: 'user-1',
      installationId: 'install-1',
    });
  });

  it('deactivates invalid tokens reported by FCM', async () => {
    const prisma = makePrisma();
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await service.deactivateInvalid(['bad-1', 'bad-2']);

    expect(prisma.deviceToken.updateMany).toHaveBeenCalledWith({
      where: { token: { in: ['bad-1', 'bad-2'] } },
      data: { isActive: false },
    });
  });

  it('no-ops when there are no invalid tokens', async () => {
    const prisma = makePrisma();
    const service = new DeviceTokensService(prisma as unknown as PrismaService);

    await service.deactivateInvalid([]);

    expect(prisma.deviceToken.updateMany).not.toHaveBeenCalled();
  });
});
