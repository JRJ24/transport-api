import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DriverVerificationGuard } from '@/common/guards/driver-verification.guard';
import type { PrismaService } from '@/database/prisma.service';
import { DevicesController } from './devices.controller';

const pendingDriver = { id: 'drv-user-1', roles: ['DRIVER'] };

function makeGuard() {
  const prisma = {
    driverProfile: {
      findFirst: jest.fn().mockResolvedValue({ verificationStatus: 'PENDING' }),
    },
  };
  const guard = new DriverVerificationGuard(
    new Reflector(),
    prisma as unknown as PrismaService,
  );
  return { guard, prisma };
}

function contextFor(
  cls: new (...args: never[]) => unknown,
  handler: (...args: never[]) => unknown,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user: pendingDriver }) }),
  } as unknown as ExecutionContext;
}

describe('DevicesController + DriverVerificationGuard', () => {
  it.each([
    ['register', DevicesController.prototype.register],
    ['listMine', DevicesController.prototype.listMine],
    ['remove', DevicesController.prototype.remove],
  ])(
    'lets a driver pending approval reach %s (push token self-service)',
    async (_name, handler) => {
      const { guard, prisma } = makeGuard();

      await expect(
        guard.canActivate(contextFor(DevicesController, handler)),
      ).resolves.toBe(true);
      expect(prisma.driverProfile.findFirst).not.toHaveBeenCalled();
    },
  );

  it('still blocks a pending driver on routes without the decorator', async () => {
    class OperationalController {
      act(): void {}
    }
    const { guard } = makeGuard();

    await expect(
      guard.canActivate(
        contextFor(OperationalController, OperationalController.prototype.act),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
