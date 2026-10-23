import {
  ROLES,
  STATUS_DRIVER,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
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

describe('DriversService.updateStatus self-service (SEC-API-009)', () => {
  const actor = { id: 'user-d1', roles: [ROLES.DRIVER] } as AuthenticatedUser;
  const allowed = [STATUS_DRIVER.AVAILABLE, STATUS_DRIVER.OFFLINE];
  const restricted = [
    STATUS_DRIVER.SUSPENDED,
    STATUS_DRIVER.BUSY,
    STATUS_DRIVER.VACATION,
  ];
  type Row = {
    id: string;
    userId: string;
    availabilityStatus: STATUS_DRIVER;
    verificationStatus: VERIFICATION_STATUS;
  };
  type Where = Record<string, string | { in: string[] }>;

  function setup(
    initial: Partial<Row> = {},
    options: { missing?: boolean; beforeWrite?: Partial<Row> } = {},
  ) {
    const row: Row = {
      id: 'drv-1',
      userId: actor.id,
      availabilityStatus: STATUS_DRIVER.OFFLINE,
      verificationStatus: VERIFICATION_STATUS.APPROVED,
      ...initial,
    };
    let beforeWrite = options.beforeWrite;
    const applyConcurrentWrite = () => {
      if (beforeWrite) {
        Object.assign(row, beforeWrite);
        beforeWrite = undefined;
      }
    };
    const matches = (where: Where) =>
      !options.missing &&
      Object.entries(where).every(([key, value]) => {
        const current = row[key as keyof Row];
        return typeof value === 'string'
          ? value === current
          : value.in.includes(current);
      });
    const driverProfile = {
      findFirst: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(matches(where) ? { ...row } : null),
      ),
      // Both write methods see any restriction committed after an earlier
      // read. Only updateMany's predicate can stop that stale request.
      update: jest.fn(({ data }: { data: Partial<Row> }) => {
        applyConcurrentWrite();
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      }),
      updateMany: jest.fn(
        ({ where, data }: { where: Where; data: Partial<Row> }) => {
          applyConcurrentWrite();
          if (!matches(where)) return Promise.resolve({ count: 0 });
          Object.assign(row, data);
          return Promise.resolve({ count: 1 });
        },
      ),
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...row })),
    };
    const tx = { driverProfile };
    const prisma = {
      ...tx,
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
    const change = (target: STATUS_DRIVER, user = actor) =>
      service.updateStatus(user, row.id, { availabilityStatus: target });
    const expectNoPresenceChange = () => {
      expect(presence.forgetUser).not.toHaveBeenCalled();
      expect(presence.remove).not.toHaveBeenCalled();
    };
    return {
      row,
      driverProfile,
      prisma,
      presence,
      change,
      expectNoPresenceChange,
    };
  }

  describe('US1: restricted states and profiles stay protected', () => {
    it.each(restricted.flatMap((from) => allowed.map((to) => [from, to])))(
      'denies self-service from %s to %s',
      async (from, to) => {
        const db = setup({ availabilityStatus: from });
        await expect(db.change(to)).rejects.toMatchObject({
          status: 403,
          response: { code: 'FORBIDDEN' },
        });
        expect(db.row.availabilityStatus).toBe(from);
        db.expectNoPresenceChange();
      },
    );

    it.each(allowed.flatMap((from) => restricted.map((to) => [from, to])))(
      'denies self-service from %s to protected destination %s',
      async (from, to) => {
        const db = setup({ availabilityStatus: from });
        await expect(db.change(to)).rejects.toMatchObject({ status: 403 });
        expect(db.row.availabilityStatus).toBe(from);
        db.expectNoPresenceChange();
      },
    );

    it.each([
      { name: 'another owner', row: { userId: 'other-user' } },
      {
        name: 'pending verification',
        row: { verificationStatus: VERIFICATION_STATUS.PENDING },
      },
      {
        name: 'rejected verification',
        row: { verificationStatus: VERIFICATION_STATUS.REJECTED },
      },
    ])('denies a profile with $name', async ({ row }) => {
      const db = setup(row);
      await expect(db.change(STATUS_DRIVER.AVAILABLE)).rejects.toMatchObject({
        status: 403,
      });
      expect(db.row.availabilityStatus).toBe(STATUS_DRIVER.OFFLINE);
      db.expectNoPresenceChange();
    });

    it('denies a missing profile without presence effects', async () => {
      const db = setup({}, { missing: true });
      await expect(db.change(STATUS_DRIVER.AVAILABLE)).rejects.toMatchObject({
        status: 403,
      });
      db.expectNoPresenceChange();
    });

    it.each([
      {
        name: 'suspension',
        update: { availabilityStatus: STATUS_DRIVER.SUSPENDED },
      },
      {
        name: 'assignment',
        update: { availabilityStatus: STATUS_DRIVER.BUSY },
      },
      {
        name: 'vacation',
        update: { availabilityStatus: STATUS_DRIVER.VACATION },
      },
      {
        name: 'verification withdrawal',
        update: { verificationStatus: VERIFICATION_STATUS.PENDING },
      },
      { name: 'owner change', update: { userId: 'new-user' } },
    ])('does not overwrite a concurrent $name', async ({ update }) => {
      const db = setup({}, { beforeWrite: update });
      await expect(db.change(STATUS_DRIVER.AVAILABLE)).rejects.toMatchObject({
        status: 403,
      });
      expect(db.row).toMatchObject(update);
      db.expectNoPresenceChange();
    });
  });

  describe('US2: normal availability and staff keep working', () => {
    it.each(allowed.flatMap((from) => allowed.map((to) => [from, to])))(
      'allows an approved owner to change %s to %s',
      async (from, to) => {
        const db = setup({ availabilityStatus: from });
        const result = await db.change(to);
        expect(result).toMatchObject({ id: 'drv-1', availabilityStatus: to });
        expect(db.row.availabilityStatus).toBe(to);
        expect(db.presence.forgetUser).toHaveBeenCalledWith(actor.id);
        if (to === STATUS_DRIVER.OFFLINE) {
          expect(db.presence.remove).toHaveBeenCalledWith('drv-1');
        } else {
          expect(db.presence.remove).not.toHaveBeenCalled();
        }
      },
    );

    it.each([
      [ROLES.ADMIN],
      [ROLES.OPERATOR],
      [ROLES.DRIVER, ROLES.ADMIN],
      [ROLES.DRIVER, ROLES.OPERATOR],
    ])('preserves the staff path for roles %j', async (...roles) => {
      const db = setup({ availabilityStatus: STATUS_DRIVER.SUSPENDED });
      const staff = { ...actor, id: 'staff-user', roles };
      const result = await db.change(STATUS_DRIVER.AVAILABLE, staff);
      expect(result.availabilityStatus).toBe(STATUS_DRIVER.AVAILABLE);
      expect(db.prisma.$transaction).not.toHaveBeenCalled();
      expect(db.presence.forgetUser).toHaveBeenCalledWith(actor.id);
    });
  });
});
