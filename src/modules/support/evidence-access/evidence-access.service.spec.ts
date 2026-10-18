import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import {
  EVIDENCE_READ_ASSIGNMENT_STATUSES,
  EVIDENCE_WRITE_ASSIGNMENT_STATUSES,
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
    /** Quien capturo la prueba; por defecto el mismo usuario de los tests. */
    proofCapturedBy?: string;
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
      findUnique: jest.fn().mockResolvedValue(
        opts.proofOrderId
          ? {
              orderId: opts.proofOrderId,
              capturedBy: opts.proofCapturedBy ?? 'user-1',
            }
          : null,
      ),
    },
  };
}

function build(prisma: ReturnType<typeof makePrisma>) {
  return new EvidenceAccessService(prisma as unknown as PrismaService);
}

/**
 * Simula la base: el conductor solo tiene una asignacion en `status`, y
 * findFirst la encuentra si ese estado esta en el filtro pedido.
 */
function withAssignmentIn(
  prisma: ReturnType<typeof makePrisma>,
  status: string,
) {
  prisma.orderAssignment.findFirst.mockImplementation(
    ({ where }: { where: { assignmentStatus: { in: string[] } } }) =>
      Promise.resolve(
        where.assignmentStatus.in.includes(status) ? { id: 'asg-1' } : null,
      ),
  );
  return prisma;
}

const statusesQueried = (prisma: ReturnType<typeof makePrisma>) =>
  (
    prisma.orderAssignment.findFirst.mock.calls as [
      { where: { assignmentStatus: { in: string[] } } },
    ][]
  ).map(([query]) => query.where.assignmentStatus.in);

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

  it('read (default): driver with an assignment in PENDING/ACCEPTED/COMPLETED gets access', async () => {
    const prisma = makePrisma({ assignment: true });
    await expect(build(prisma).canAccessOrder(driver, 'order-1')).resolves.toBe(
      true,
    );
    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        driver: { userId: 'user-1' },
        assignmentStatus: { in: EVIDENCE_READ_ASSIGNMENT_STATUSES },
      },
      select: { id: true },
    });
    // Un conductor tiene que seguir viendo la evidencia de la orden que
    // acaba de entregar (la asignacion pasa a COMPLETED).
    expect(EVIDENCE_READ_ASSIGNMENT_STATUSES).toEqual([
      'PENDING',
      'ACCEPTED',
      'COMPLETED',
    ]);
  });

  it('write: only ACCEPTED/COMPLETED count, a PENDING assignment is not enough', async () => {
    expect(EVIDENCE_WRITE_ASSIGNMENT_STATUSES).toEqual([
      'ACCEPTED',
      'COMPLETED',
    ]);

    const pending = withAssignmentIn(makePrisma(), 'PENDING');
    await expect(
      build(pending).canAccessOrder(driver, 'order-1', { mode: 'write' }),
    ).resolves.toBe(false);
    expect(pending.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        driver: { userId: 'user-1' },
        assignmentStatus: { in: ['ACCEPTED', 'COMPLETED'] },
      },
      select: { id: true },
    });
    // La misma asignacion PENDING si deja ver.
    await expect(
      build(withAssignmentIn(makePrisma(), 'PENDING')).canAccessOrder(
        driver,
        'order-1',
      ),
    ).resolves.toBe(true);

    for (const status of ['ACCEPTED', 'COMPLETED']) {
      await expect(
        build(withAssignmentIn(makePrisma(), status)).canAccessOrder(
          driver,
          'order-1',
          { mode: 'write' },
        ),
      ).resolves.toBe(true);
    }
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
        const prisma = makePrisma({
          assignment: true,
          proofOrderId: 'order-1',
        });
        const service = build(prisma);
        await expect(
          service.assertEntityAccess(driver, type, 'proof-1', 'read'),
        ).resolves.toBeUndefined();
        await expect(
          service.assertEntityAccess(driver, type, 'proof-1', 'write'),
        ).resolves.toBeUndefined();
        expect(prisma.deliveryProof.findUnique).toHaveBeenCalledWith({
          where: { id: 'proof-1' },
          select: { orderId: true, capturedBy: true },
        });
        const [query] = prisma.orderAssignment.findFirst.mock.calls[0] as [
          { where: { orderId: string } },
        ];
        expect(query.where.orderId).toBe('order-1');
        // read con los estados de lectura, write con los de escritura.
        expect(statusesQueried(prisma)).toEqual([
          EVIDENCE_READ_ASSIGNMENT_STATUSES,
          EVIDENCE_WRITE_ASSIGNMENT_STATUSES,
        ]);
      },
    );

    it('DeliveryProof with only a PENDING assignment: read allowed, write 403', async () => {
      const prisma = withAssignmentIn(
        makePrisma({ proofOrderId: 'order-1' }),
        'PENDING',
      );
      const service = build(prisma);
      await expect(
        service.assertEntityAccess(driver, 'DeliveryProof', 'proof-1', 'read'),
      ).resolves.toBeUndefined();
      const error = await service
        .assertEntityAccess(driver, 'DeliveryProof', 'proof-1', 'write')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        code: 'FORBIDDEN',
        message: 'You cannot access the evidence of this order',
      });
    });

    it('ORDER with only a PENDING assignment: read allowed, write 403', async () => {
      const prisma = withAssignmentIn(makePrisma(), 'PENDING');
      const service = build(prisma);
      await expect(
        service.assertEntityAccess(driver, 'ORDER', 'order-1', 'read'),
      ).resolves.toBeUndefined();
      await expect(
        service.assertEntityAccess(driver, 'ORDER', 'order-1', 'write'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(statusesQueried(prisma)).toEqual([
        EVIDENCE_READ_ASSIGNMENT_STATUSES,
        EVIDENCE_WRITE_ASSIGNMENT_STATUSES,
      ]);
    });

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

    it('DeliveryProof captured by another driver of the same order (reassigned): read allowed, write the same 403', async () => {
      // El conductor tiene la orden ACCEPTED, pero la prueba la capturo el
      // conductor anterior: la puede ver, no colgarle archivos.
      const prisma = makePrisma({
        assignment: true,
        proofOrderId: 'order-1',
        proofCapturedBy: 'user-previous',
      });
      const service = build(prisma);
      await expect(
        service.assertEntityAccess(driver, 'DeliveryProof', 'proof-1', 'read'),
      ).resolves.toBeUndefined();

      const foreignProof = await service
        .assertEntityAccess(driver, 'DeliveryProof', 'proof-1', 'write')
        .catch((e: unknown) => e);
      const unknownProof = await build(
        makePrisma({ assignment: true, proofOrderId: null }),
      )
        .assertEntityAccess(driver, 'DeliveryProof', 'nope', 'write')
        .catch((e: unknown) => e);

      expect(foreignProof).toBeInstanceOf(ForbiddenException);
      expect((foreignProof as ForbiddenException).getResponse()).toEqual({
        code: 'FORBIDDEN',
        message: 'You cannot access the evidence of this order',
      });
      // Misma respuesta que una prueba inexistente: no dice de quien es.
      expect((foreignProof as ForbiddenException).getResponse()).toEqual(
        (unknownProof as ForbiddenException).getResponse(),
      );
    });

    it('ORDER writes do not look at who captured a proof', async () => {
      const prisma = makePrisma({ assignment: true });
      await expect(
        build(prisma).assertEntityAccess(driver, 'ORDER', 'order-1', 'write'),
      ).resolves.toBeUndefined();
      expect(prisma.deliveryProof.findUnique).not.toHaveBeenCalled();
    });

    it('unknown DeliveryProof id: same 403, existence is not revealed', async () => {
      const prisma = makePrisma({ assignment: true, proofOrderId: null });
      await expect(
        build(prisma).assertEntityAccess(
          driver,
          'DeliveryProof',
          'nope',
          'read',
        ),
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
      // Aunque figure como quien la capturo: el cliente no escribe pruebas.
      const prisma = makePrisma({
        ownOrder: true,
        proofOrderId: 'order-1',
        proofCapturedBy: 'user-1',
      });
      const service = build(prisma);
      await expect(
        service.assertEntityAccess(
          customer,
          'DeliveryProof',
          'proof-1',
          'read',
        ),
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

    it('ORDER: own order read allowed, foreign order denied', async () => {
      const own = build(makePrisma({ ownOrder: true }));
      await expect(
        own.assertEntityAccess(customer, 'ORDER', 'order-1', 'read'),
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

    it.each(['ORDER', 'Order', 'TransportOrder'])(
      '%s write (upload) on their own order is the same 403 as a foreign one',
      async (type) => {
        // Ninguna app de cliente sube adjuntos; las incidencias usan
        // assertOrderAccess con allowCustomer explicito.
        const prisma = makePrisma({ ownOrder: true });
        const ownError = await build(prisma)
          .assertEntityAccess(customer, type, 'order-1', 'write')
          .catch((e: unknown) => e);
        const foreignError = await build(makePrisma({ ownOrder: false }))
          .assertEntityAccess(customer, type, 'order-9', 'write')
          .catch((e: unknown) => e);

        expect(ownError).toBeInstanceOf(ForbiddenException);
        expect((ownError as ForbiddenException).getResponse()).toEqual({
          code: 'FORBIDDEN',
          message: 'You cannot access the evidence of this order',
        });
        expect((ownError as ForbiddenException).getResponse()).toEqual(
          (foreignError as ForbiddenException).getResponse(),
        );
        // Ni se consulta la propiedad: el rol cliente no cuenta para escribir.
        expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
      },
    );

    it('a DRIVER+CUSTOMER user writes ORDER attachments only through an assignment', async () => {
      const both = asRole('DRIVER', 'CUSTOMER');
      await expect(
        build(
          makePrisma({ assignment: false, ownOrder: true }),
        ).assertEntityAccess(both, 'ORDER', 'order-1', 'write'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        build(
          makePrisma({ assignment: true, ownOrder: false }),
        ).assertEntityAccess(both, 'ORDER', 'order-1', 'write'),
      ).resolves.toBeUndefined();
    });

    it('assertOrderAccess with allowCustomer:true still lets the customer write their own order (incidents)', async () => {
      const own = makePrisma({ ownOrder: true });
      await expect(
        build(own).assertOrderAccess(customer, 'order-1', {
          mode: 'write',
          allowCustomer: true,
        }),
      ).resolves.toBeUndefined();
      expect(own.transportOrder.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-1', customer: { userId: 'user-1' } },
        select: { id: true },
      });
      await expect(
        build(makePrisma({ ownOrder: false })).assertOrderAccess(
          customer,
          'order-9',
          { mode: 'write', allowCustomer: true },
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
