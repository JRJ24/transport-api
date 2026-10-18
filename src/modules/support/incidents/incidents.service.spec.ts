import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import type { RealtimeService } from '@/modules/realtime/realtime.service';
import type { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import {
  EVIDENCE_READ_ASSIGNMENT_STATUSES,
  EVIDENCE_WRITE_ASSIGNMENT_STATUSES,
  EvidenceAccessService,
} from '../evidence-access/evidence-access.service';
import {
  INCIDENT_COMMENT_DENIED,
  INCIDENT_LIST_DENIED,
  INCIDENT_REPORT_DENIED,
  IncidentsService,
} from './incidents.service';
import type { CreateIncidentDto } from './dto/create-incident.dto';

const base: AuthenticatedUser = {
  id: 'user-1',
  email: 'u@x.com',
  fullName: 'User',
  status: 'ACTIVE' as never,
  roles: [],
  permissions: [],
  sessionId: 's1',
};
const driver = { ...base, roles: ['DRIVER'] as never };
const customer = { ...base, roles: ['CUSTOMER'] as never };
const operator = { ...base, roles: ['OPERATOR'] as never };
const admin = { ...base, roles: ['ADMIN'] as never };

const dto: CreateIncidentDto = {
  orderId: 'order-1',
  incidentType: 'DELAY' as never,
  severity: 'LOW' as never,
  title: '  Retraso  ',
  description: '  Trafico  ',
  latitude: 18.48,
  longitude: -69.93,
};

function makePrisma(
  opts: {
    assignment?: boolean;
    ownOrder?: boolean;
    incidentOrderId?: string | null;
  } = {},
) {
  return {
    incident: {
      findMany: jest.fn().mockResolvedValue([{ id: 'inc-1' }]),
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.incidentOrderId ? { orderId: opts.incidentOrderId } : null,
        ),
      create: jest.fn().mockResolvedValue({
        id: 'inc-new',
        orderId: 'order-1',
        title: 'Retraso',
        severity: 'LOW',
        status: 'OPEN',
        reportedAt: new Date('2026-10-08T12:00:00Z'),
      }),
    },
    incidentComment: {
      create: jest.fn().mockResolvedValue({ id: 'com-1' }),
    },
    orderAssignment: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.assignment ? { id: 'asg-1' } : null),
    },
    transportOrder: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.ownOrder ? { id: 'order-1' } : null),
      // notifyOperators (fire-and-forget despues de crear).
      findUnique: jest.fn().mockResolvedValue({ orderCode: 'ORD-1' }),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

type FakePrisma = ReturnType<typeof makePrisma>;

function makeDeps() {
  return {
    realtime: {
      emitIncidentCreated: jest.fn(),
      emitIncidentUpdated: jest.fn(),
    },
    notifications: { dispatch: jest.fn().mockResolvedValue(undefined) },
  };
}

/** Con el EvidenceAccessService real: prueba la regla de punta a punta. */
function build(prisma: FakePrisma, deps = makeDeps()) {
  const asPrisma = prisma as unknown as PrismaService;
  return new IncidentsService(
    asPrisma,
    deps.realtime as unknown as RealtimeService,
    deps.notifications as unknown as NotificationDispatcherService,
    new EvidenceAccessService(asPrisma),
  );
}

/** Con el acceso simulado: prueba que modo y mensaje se piden. */
function buildWithAccess(
  prisma: FakePrisma,
  access: {
    isStaff: jest.Mock;
    assertOrderAccess: jest.Mock;
    assertEntityAccess: jest.Mock;
  },
) {
  const deps = makeDeps();
  return new IncidentsService(
    prisma as unknown as PrismaService,
    deps.realtime as unknown as RealtimeService,
    deps.notifications as unknown as NotificationDispatcherService,
    access as unknown as EvidenceAccessService,
  );
}

const allowAll = () => ({
  isStaff: jest.fn().mockReturnValue(false),
  assertOrderAccess: jest.fn().mockResolvedValue(undefined),
  assertEntityAccess: jest.fn().mockResolvedValue(undefined),
});

const findManyArgs = (prisma: FakePrisma) =>
  prisma.incident.findMany.mock.calls[0][0] as {
    where: Record<string, unknown>;
    include: { user: { select: Record<string, boolean> } };
  };

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

const forbiddenBody = (message: string) => ({ code: 'FORBIDDEN', message });

describe('IncidentsService.list scoping', () => {
  it.each([
    ['OPERATOR', operator],
    ['ADMIN', admin],
  ])(
    '%s keeps arbitrary filters without orderId and sees the reporter email (portal)',
    async (_label, user) => {
      const prisma = makePrisma();
      await build(prisma).list(user, { status: 'OPEN' as never });
      const args = findManyArgs(prisma);
      expect(args.where).toEqual({ status: 'OPEN' });
      expect(args.include.user.select).toEqual({
        id: true,
        fullName: true,
        email: true,
      });
      expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
      expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['driver', driver],
    ['customer', customer],
  ])('%s without orderId gets 400 and no query runs', async (_l, user) => {
    const prisma = makePrisma({ assignment: true, ownOrder: true });
    const error = await caught(build(prisma).list(user, { search: 'ORD' }));
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      code: 'BAD_REQUEST',
      message: 'orderId is required',
    });
    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });

  it('asks for read access to the order with the incidents message', async () => {
    const access = allowAll();
    const prisma = makePrisma();
    await buildWithAccess(prisma, access).list(driver, { orderId: 'order-1' });
    expect(access.assertOrderAccess).toHaveBeenCalledWith(driver, 'order-1', {
      message: INCIDENT_LIST_DENIED,
    });
    // Sin mode: lectura, el mismo alcance que ver la evidencia.
    const [, , options] = access.assertOrderAccess.mock.calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(options.mode).toBeUndefined();
  });

  it('assigned driver lists only that order, without the reporter email', async () => {
    const prisma = makePrisma({ assignment: true });
    const result = await build(prisma).list(driver, { orderId: 'order-1' });
    expect(result).toEqual([{ id: 'inc-1' }]);
    const args = findManyArgs(prisma);
    expect(args.where).toEqual({ orderId: 'order-1' });
    expect(args.include.user.select).toEqual({
      id: true,
      fullName: true,
      email: false,
    });
    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderId: 'order-1',
          driver: { userId: 'user-1' },
        }) as unknown,
      }),
    );
  });

  it('search never escapes the order scope for a driver', async () => {
    const prisma = makePrisma({ assignment: true });
    await build(prisma).list(driver, { orderId: 'order-1', search: ' ORD ' });
    const { where } = findManyArgs(prisma);
    // Prisma combina con AND las claves de primer nivel: OR filtra dentro
    // de la orden, no la reemplaza.
    expect(where.orderId).toBe('order-1');
    expect(where.OR).toHaveLength(3);
  });

  it('driver not assigned to the order gets 403 and nothing is read', async () => {
    const prisma = makePrisma({ assignment: false });
    const error = await caught(
      build(prisma).list(driver, { orderId: 'order-9' }),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual(
      forbiddenBody(INCIDENT_LIST_DENIED),
    );
    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });

  it('customer lists the incidents of their own order without the reporter email', async () => {
    const prisma = makePrisma({ ownOrder: true });
    await build(prisma).list(customer, { orderId: 'order-1' });
    expect(prisma.transportOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-1', customer: { userId: 'user-1' } },
      select: { id: true },
    });
    const args = findManyArgs(prisma);
    expect(args.where).toEqual({ orderId: 'order-1' });
    expect(args.include.user.select.email).toBe(false);
  });

  it('customer gets 403 for an order of another customer', async () => {
    const prisma = makePrisma({ ownOrder: false });
    const error = await caught(
      build(prisma).list(customer, { orderId: 'order-9' }),
    );
    expect((error as ForbiddenException).getResponse()).toEqual(
      forbiddenBody(INCIDENT_LIST_DENIED),
    );
    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });
});

describe('IncidentsService.create access', () => {
  it('asks for WRITE access to the order with the customer explicitly allowed (not the attachments path)', async () => {
    const access = allowAll();
    const prisma = makePrisma();
    await buildWithAccess(prisma, access).create(driver, dto);
    expect(access.assertOrderAccess).toHaveBeenCalledWith(driver, 'order-1', {
      mode: 'write',
      allowCustomer: true,
      message: INCIDENT_REPORT_DENIED,
    });
    // El camino ORDER de los adjuntos ya no deja escribir al cliente.
    expect(access.assertEntityAccess).not.toHaveBeenCalled();
    expect(prisma.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        reportedBy: 'user-1',
        title: 'Retraso',
        description: 'Trafico',
        status: 'OPEN',
      }) as unknown,
    });
  });

  it('assigned driver reports and operators get the realtime event', async () => {
    const prisma = makePrisma({ assignment: true });
    const deps = makeDeps();
    await expect(build(prisma, deps).create(driver, dto)).resolves.toEqual(
      expect.objectContaining({ id: 'inc-new' }),
    );
    expect(deps.realtime.emitIncidentCreated).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: 'inc-new', reportedBy: 'user-1' }),
    );
  });

  it('driver without a usable assignment gets 403 and nothing is created', async () => {
    const prisma = makePrisma({ assignment: false });
    const deps = makeDeps();
    const error = await caught(build(prisma, deps).create(driver, dto));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual(
      forbiddenBody(INCIDENT_REPORT_DENIED),
    );
    expect(prisma.incident.create).not.toHaveBeenCalled();
    expect(deps.realtime.emitIncidentCreated).not.toHaveBeenCalled();
  });

  it('customer reports on their own order (app-customers IncidentsPanel)', async () => {
    const prisma = makePrisma({ ownOrder: true });
    await build(prisma).create(customer, dto);
    expect(prisma.transportOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-1', customer: { userId: 'user-1' } },
      select: { id: true },
    });
    expect(prisma.incident.create).toHaveBeenCalledTimes(1);
  });

  it('customer: foreign and unknown order give the same 403 (no 404 oracle)', async () => {
    const prisma = makePrisma({ ownOrder: false });
    const error = await caught(
      build(prisma).create(customer, { ...dto, orderId: 'nope' }),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual(
      forbiddenBody(INCIDENT_REPORT_DENIED),
    );
    expect(prisma.incident.create).not.toHaveBeenCalled();
  });

  it('staff reports on any order without ownership lookups (portal)', async () => {
    const prisma = makePrisma();
    await build(prisma).create(operator, dto);
    expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
    expect(prisma.transportOrder.findFirst).not.toHaveBeenCalled();
    expect(prisma.incident.create).toHaveBeenCalledTimes(1);
  });

  it('customer: reporting works while uploading attachments to that same order is denied', async () => {
    // Misma base y el EvidenceAccessService real: la incidencia pasa, el
    // upload (assertEntityAccess ORDER write, el de /attachments/upload) no.
    const prisma = makePrisma({ ownOrder: true });
    const asPrisma = prisma as unknown as PrismaService;
    const access = new EvidenceAccessService(asPrisma);
    await build(prisma).create(customer, dto);
    expect(prisma.incident.create).toHaveBeenCalledTimes(1);
    await expect(
      access.assertEntityAccess(customer, 'ORDER', 'order-1', 'write'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('errors that are not a 403 propagate unchanged', async () => {
    const access = allowAll();
    const boom = new Error('db down');
    access.assertOrderAccess.mockRejectedValue(boom);
    const prisma = makePrisma();
    await expect(
      buildWithAccess(prisma, access).create(driver, dto),
    ).rejects.toBe(boom);
    expect(prisma.incident.create).not.toHaveBeenCalled();
  });
});

describe('IncidentsService.addComment access', () => {
  const body = { comment: '  Ya voy en camino  ' };

  it('staff comments without loading the incident (portal, unchanged)', async () => {
    const prisma = makePrisma();
    await build(prisma).addComment(operator, 'inc-1', body);
    expect(prisma.incident.findUnique).not.toHaveBeenCalled();
    expect(prisma.incidentComment.create).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-1',
        userId: 'user-1',
        comment: 'Ya voy en camino',
      },
    });
  });

  it('loads the incident order and asks for WRITE access to it', async () => {
    const access = allowAll();
    const prisma = makePrisma({ incidentOrderId: 'order-1' });
    await buildWithAccess(prisma, access).addComment(driver, 'inc-1', body);
    expect(prisma.incident.findUnique).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      select: { orderId: true },
    });
    expect(access.assertOrderAccess).toHaveBeenCalledWith(driver, 'order-1', {
      mode: 'write',
      allowCustomer: true,
      message: INCIDENT_COMMENT_DENIED,
    });
    expect(access.assertEntityAccess).not.toHaveBeenCalled();
    expect(prisma.incidentComment.create).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-1',
        userId: 'user-1',
        comment: 'Ya voy en camino',
      },
    });
  });

  it.each([
    ['driver', driver],
    ['customer', customer],
  ])(
    '%s: unknown incident and incident of a foreign order give the same 403',
    async (_l, user) => {
      const missing = makePrisma({
        incidentOrderId: null,
        assignment: true,
        ownOrder: true,
      });
      const missingError = await caught(
        build(missing).addComment(user, 'nope', body),
      );
      // Sin incidencia no se llega a mirar la orden.
      expect(missing.orderAssignment.findFirst).not.toHaveBeenCalled();
      expect(missing.transportOrder.findFirst).not.toHaveBeenCalled();

      const foreign = makePrisma({
        incidentOrderId: 'order-9',
        assignment: false,
        ownOrder: false,
      });
      const foreignError = await caught(
        build(foreign).addComment(user, 'inc-9', body),
      );

      for (const error of [missingError, foreignError]) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toEqual(
          forbiddenBody(INCIDENT_COMMENT_DENIED),
        );
      }
      expect(missing.incidentComment.create).not.toHaveBeenCalled();
      expect(foreign.incidentComment.create).not.toHaveBeenCalled();
    },
  );

  it('assigned driver comments on an incident of their order', async () => {
    const prisma = makePrisma({ incidentOrderId: 'order-1', assignment: true });
    await expect(
      build(prisma).addComment(driver, 'inc-1', body),
    ).resolves.toEqual({ id: 'com-1' });
  });

  it('a non-403 error while checking access propagates and nothing is inserted', async () => {
    const access = allowAll();
    const boom = new Error('db down');
    access.assertOrderAccess.mockRejectedValue(boom);
    const prisma = makePrisma({ incidentOrderId: 'order-1' });
    await expect(
      buildWithAccess(prisma, access).addComment(driver, 'inc-1', body),
    ).rejects.toBe(boom);
    expect(prisma.incidentComment.create).not.toHaveBeenCalled();
  });

  it('customer comments on an incident of their own order (IncidentsPanel)', async () => {
    const prisma = makePrisma({ incidentOrderId: 'order-1', ownOrder: true });
    await build(prisma).addComment(customer, 'inc-1', body);
    expect(prisma.transportOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-1', customer: { userId: 'user-1' } },
      select: { id: true },
    });
    expect(prisma.incidentComment.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * Con el EvidenceAccessService real, que estados de asignacion cuentan de
 * verdad en cada camino. Los mocks de arriba solo ven que se pide 'write';
 * esto ve que 'write' llega a la consulta (en la version anterior de
 * assertEntityAccess el camino ORDER ignoraba el modo y una asignacion
 * PENDING dejaba reportar y comentar).
 */
describe('IncidentsService assignment statuses (real EvidenceAccessService)', () => {
  const statusesQueried = (prisma: FakePrisma) =>
    prisma.orderAssignment.findFirst.mock.calls.map(
      ([args]) =>
        (args as { where: { assignmentStatus: { in: string[] } } }).where
          .assignmentStatus.in,
    );

  it('reporting and commenting only count ACCEPTED/COMPLETED assignments (no PENDING)', async () => {
    const prisma = makePrisma({ assignment: true, incidentOrderId: 'order-1' });
    const service = build(prisma);
    await service.create(driver, dto);
    await service.addComment(driver, 'inc-1', { comment: 'Llegando' });

    expect(statusesQueried(prisma)).toEqual([
      EVIDENCE_WRITE_ASSIGNMENT_STATUSES,
      EVIDENCE_WRITE_ASSIGNMENT_STATUSES,
    ]);
    expect(EVIDENCE_WRITE_ASSIGNMENT_STATUSES).not.toContain('PENDING');
  });

  it('listing uses the read statuses, like viewing the evidence', async () => {
    const prisma = makePrisma({ assignment: true });
    await build(prisma).list(driver, { orderId: 'order-1' });
    expect(statusesQueried(prisma)).toEqual([
      EVIDENCE_READ_ASSIGNMENT_STATUSES,
    ]);
  });
});
