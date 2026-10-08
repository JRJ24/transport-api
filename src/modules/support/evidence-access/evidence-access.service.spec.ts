import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import {
  EVIDENCE_ASSIGNMENT_STATUSES,
  EvidenceAccessService,
  normalizeEvidenceEntityType,
} from './evidence-access.service';

const base: AuthenticatedUser = {
  id: 'user-1',
  email: 'u@x.com',
  fullName: 'User',
  status: 'ACTIVE' as never,
  roles: [],
  permissions: [],
  sessionId: 's1',
};

const asRole = (...roles: string[]): AuthenticatedUser => ({
  ...base,
  roles: roles as never,
});

const admin = asRole('ADMIN');
const operator = asRole('OPERATOR');
const driver = asRole('DRIVER');
const customer = asRole('CUSTOMER');

function makePrisma(
  opts: {
    assignment?: boolean;
    ownOrder?: boolean;
    proofOrderId?: string | null;
  } = {},
) {
  return {
    orderAssignment: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.assignment ? { id: 'asg-1' } : null),
    },
    transportOrder: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.ownOrder ? { id: 'order-1' } : null),
    },
    deliveryProof: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.proofOrderId ? { orderId: opts.proofOrderId } : null,
        ),
    },
  };
}

function build(prisma: ReturnType<typeof makePrisma>) {
  return new EvidenceAccessService(prisma as unknown as PrismaService);
}

describe('normalizeEvidenceEntityType', () => {
  it.each([
    ['DeliveryProof', 'DELIVERY_PROOF'],
    ['DELIVERY_PROOF', 'DELIVERY_PROOF'],
    ['delivery_proof', 'DELIVERY_PROOF'],
    ['delivery-proof', 'DELIVERY_PROOF'],
    ['ORDER', 'ORDER'],
    ['Order', 'ORDER'],
    ['TransportOrder', 'ORDER'],
    ['Incident', null],
    ['Vehicle', null],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeEvidenceEntityType(input)).toBe(expected);
  });
});

describe('EvidenceAccessService.canAccessOrder', () => {
  it.each([admin, operator])(
    'staff (%#) is unrestricted and never hits the database',
    async (user) => {
      const prisma = makePrisma();
      await expect(build(prisma).canAccessOrder(user, 'order-1')).resolves.toBe(
        true,
      );
      expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
      expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
    },
  );

  it('driver with an assignment in PENDING/ACCEPTED/COMPLETED gets access', async () => {
    const prisma = makePrisma({ assignment: true });
    await expect(build(prisma).canAccessOrder(driver, 'order-1')).resolves.toBe(
      true,
    );
    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        driver: { userId: 'user-1' },
        assignmentStatus: { in: EVIDENCE_ASSIGNMENT_STATUSES },
      },
      select: { id: true },
    });
    // Un conductor tiene que seguir viendo la evidencia de la orden que
    // acaba de entregar (la asignacion pasa a COMPLETED).
    expect(EVIDENCE_ASSIGNMENT_STATUSES).toEqual([
      'PENDING',
      'ACCEPTED',
      'COMPLETED',
    ]);
  });

  it('driver without a matching assignment is denied (no customer fallback)', async () => {
    const prisma = makePrisma({ assignment: false, ownOrder: true });
    await expect(build(prisma).canAccessOrder(driver, 'order-1')).resolves.toBe(
      false,
    );
    expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
  });

  it('customer only sees orders of their own customer account', async () => {
    const own = makePrisma({ ownOrder: true });
    await expect(build(own).canAccessOrder(customer, 'order-1')).resolves.toBe(
      true,
    );
    expect(own.transportOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-1', customer: { userId: 'user-1' } },
      select: { id: true },
    });
    expect(own.orderAssignment.findFirst).not.toHaveBeenCalled();

    const foreign = makePrisma({ ownOrder: false });
    await expect(
      build(foreign).canAccessOrder(customer, 'order-2'),
    ).resolves.toBe(false);
  });

  it('allowCustomer:false ignores customer ownership', async () => {
    const prisma = makePrisma({ ownOrder: true });
    await expect(
      build(prisma).canAccessOrder(customer, 'order-1', {
        allowCustomer: false,
      }),
    ).resolves.toBe(false);
    expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
  });

  it('a user that is both driver and customer gets in through either role', async () => {
    const prisma = makePrisma({ assignment: false, ownOrder: true });
    await expect(
      build(prisma).canAccessOrder(asRole('DRIVER', 'CUSTOMER'), 'order-1'),
    ).resolves.toBe(true);
  });
});

describe('EvidenceAccessService.assertOrderAccess', () => {
  it('throws 403 with the FORBIDDEN code and the given message', async () => {
    const prisma = makePrisma();
    const error = await build(prisma)
      .assertOrderAccess(driver, 'order-1', { message: 'nope' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({
      code: 'FORBIDDEN',
      message: 'nope',
    });
  });
});

describe('EvidenceAccessService.assertEntityAccess', () => {
  const kinds = ['DeliveryProof', 'DELIVERY_PROOF', 'ORDER', 'Incident'];

  describe.each([
    ['ADMIN', admin],
    ['OPERATOR', operator],
  ])('%s', (_label, user) => {
    it.each(kinds)('%s is unrestricted for read and write', async (type) => {
      const prisma = makePrisma();
      const service = build(prisma);
      await expect(
        service.assertEntityAccess(user, type, 'x-1', 'read'),
      ).resolves.toBeUndefined();
      await expect(
        service.assertEntityAccess(user, type, 'x-1', 'write'),
      ).resolves.toBeUndefined();
      expect(prisma.deliveryProof.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('DRIVER', () => {
    it.each(['DeliveryProof', 'DELIVERY_PROOF', 'delivery_proof'])(
      '%s of an assigned order: read and write allowed',
      async (type) => {
        const prisma = makePrisma({ assignment: true, proofOrderId: 'order-1' });
        const service = build(prisma);
        await expect(
          service.assertEntityAccess(driver, type, 'proof-1', 'read'),
        ).resolves.toBeUndefined();
        await expect(
          service.assertEntityAccess(driver, type, 'proof-1', 'write'),
        ).resolves.toBeUndefined();
        expect(prisma.deliveryProof.findUnique).toHaveBeenCalledWith({
          where: { id: 'proof-1' },
          select: { orderId: true },
        });
        expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ orderId: 'order-1' }),
          }),
        );
      },
    );

    it('DeliveryProof of another driver order: 403 for read and write', async () => {
      const prisma = makePrisma({ assignment: false, proofOrderId: 'order-9' });
      const service = build(prisma);
      await expect(
        service.assertEntityAccess(driver, 'DeliveryProof', 'proof-9', 'read'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.assertEntityAccess(driver, 'DeliveryProof', 'proof-9', 'write'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('unknown DeliveryProof id: same 403, existence is not revealed', async () => {
      const prisma = makePrisma({ assignment: true, proofOrderId: null });
      await expect(
        build(prisma).assertEntityAccess(driver, 'DeliveryProof', 'nope', 'read'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
    });

    it('ORDER: allowed only with an assignment', async () => {
      await expect(
        build(makePrisma({ assignment: true })).assertEntityAccess(
          driver,
          'ORDER',
          'order-1',
          'write',
        ),
      ).resolves.toBeUndefined();
      await expect(
        build(makePrisma({ assignment: false })).assertEntityAccess(
          driver,
          'Order',
          'order-2',
          'read',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('any other entityType is denied without touching the database', async () => {
      const prisma = makePrisma({ assignment: true });
      await expect(
        build(prisma).assertEntityAccess(driver, 'Incident', 'inc-1', 'read'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('CUSTOMER', () => {
    it('DeliveryProof of own order: read allowed, write denied', async () => {
      const prisma = makePrisma({ ownOrder: true, proofOrderId: 'order-1' });
      const service = build(prisma);
      await expect(
        service.assertEntityAccess(customer, 'DeliveryProof', 'proof-1', 'read'),
      ).resolves.toBeUndefined();
      // La foto de la prueba cuenta para cerrar la entrega: no la escribe el
      // cliente.
      await expect(
        service.assertEntityAccess(
          customer,
          'DeliveryProof',
          'proof-1',
          'write',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('DeliveryProof of someone else order: 403', async () => {
      const prisma = makePrisma({ ownOrder: false, proofOrderId: 'order-9' });
      await expect(
        build(prisma).assertEntityAccess(
          customer,
          'DELIVERY_PROOF',
          'proof-9',
          'read',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ORDER: own order read and write allowed, foreign order denied', async () => {
      const own = build(makePrisma({ ownOrder: true }));
      await expect(
        own.assertEntityAccess(customer, 'ORDER', 'order-1', 'read'),
      ).resolves.toBeUndefined();
      await expect(
        own.assertEntityAccess(customer, 'ORDER', 'order-1', 'write'),
      ).resolves.toBeUndefined();
      await expect(
        build(makePrisma({ ownOrder: false })).assertEntityAccess(
          customer,
          'ORDER',
          'order-9',
          'read',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('any other entityType is denied', async () => {
      await expect(
        build(makePrisma({ ownOrder: true })).assertEntityAccess(
          customer,
          'Vehicle',
          'veh-1',
          'read',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
