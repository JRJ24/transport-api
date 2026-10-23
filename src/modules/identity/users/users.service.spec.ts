import type { ConfigType } from '@nestjs/config';
import { STATUS_ACCOUNT } from '@generated/prisma/enums';
import type { authConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import { UsersService } from './users.service';

function setup() {
  const user = { id: 'u1', status: STATUS_ACCOUNT.ACTIVE, userRoles: [] };
  const tx = {
    user: {
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...user, ...data }),
      ),
    },
    userSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    user: {
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...user, ...data }),
      ),
    },
    userSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    {} as ConfigType<typeof authConfig>,
  );

  return { service, prisma, tx };
}

describe('UsersService.setStatus revokes sessions (SEC-API-019)', () => {
  it.each([STATUS_ACCOUNT.BLOCKED, STATUS_ACCOUNT.INACTIVE])(
    'revokes every session in the same transaction when the account becomes %s',
    async (status) => {
      const { service, prisma, tx } = setup();

      const result = await service.setStatus('u1', status);

      expect(result.status).toBe(status);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { status } }),
      );
      expect(tx.userSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            revokedAt: null,
          }) as unknown,
        }),
      );
    },
  );

  it('does not revoke anything when the account is set back to ACTIVE', async () => {
    const { service, prisma, tx } = setup();

    await service.setStatus('u1', STATUS_ACCOUNT.ACTIVE);

    expect(tx.userSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('fails as a whole when the sessions cannot be revoked', async () => {
    const { service, tx } = setup();
    tx.userSession.updateMany.mockRejectedValue(new Error('db down'));

    await expect(
      service.setStatus('u1', STATUS_ACCOUNT.BLOCKED),
    ).rejects.toThrow('db down');
  });
});
