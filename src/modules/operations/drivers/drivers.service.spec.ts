import { STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';
import type { PrismaService } from '@/database/prisma.service';
import type { PresenceService } from '../presence/presence.service';
import { DriversService } from './drivers.service';

describe('DriversService.softDelete revokes sessions (SEC-API-019)', () => {
  it('revokes the driver sessions inside the soft-delete transaction and audits the count', async () => {
    const driver = {
      id: 'drv-1',
      userId: 'user-d1',
      availabilityStatus: STATUS_DRIVER.SUSPENDED,
      verificationStatus: VERIFICATION_STATUS.APPROVED,
      user: { id: 'user-d1', status: 'ACTIVE' },
    };
    const tx = {
      driverProfile: {
        findUnique: jest.fn().mockResolvedValue(driver),
        update: jest.fn().mockResolvedValue(driver),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      userSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      vehicle: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const presence = {
      forgetUser: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DriversService(
      prisma as unknown as PrismaService,
      presence as unknown as PresenceService,
    );

    await service.softDelete('drv-1', 'admin-1');

    expect(tx.userSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-d1',
          revokedAt: null,
        }) as unknown,
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newValues: expect.objectContaining({ revokedSessions: 2 }) as unknown,
      }) as unknown,
    });
  });
});
