import { ROLES } from '@generated/prisma/enums';
import type { PrismaService } from '@/database/prisma.service';
import { RolesService } from './roles.service';

function setup() {
  const prisma = {
    role: {
      findUnique: jest.fn().mockResolvedValue({ id: 'role-admin' }),
    },
    userRole: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const service = new RolesService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('RolesService.assign is idempotent under concurrency (FIA-API-011)', () => {
  it('inserts the role with ON CONFLICT DO NOTHING instead of read-then-write', async () => {
    const { service, prisma } = setup();

    await service.assign('u1', ROLES.ADMIN);

    expect(prisma.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userID: 'u1', roleID: 'role-admin' }],
      skipDuplicates: true,
    });
    expect(prisma.userRole.findFirst).not.toHaveBeenCalled();
    expect(prisma.userRole.create).not.toHaveBeenCalled();
  });

  it('still revokes every matching assignment', async () => {
    const { service, prisma } = setup();

    await service.revoke('u1', ROLES.ADMIN);

    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userID: 'u1', roleID: 'role-admin' },
    });
  });
});
