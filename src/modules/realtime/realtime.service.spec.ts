import type { HttpAdapterHost } from '@nestjs/core';
import { ASSIGNMENT_STATUS } from '@generated/prisma/enums';
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { appConfig, authConfig, matchingConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import type { SessionsService } from '@/modules/identity/sessions/sessions.service';
import type { PresenceService } from '@/modules/operations/presence/presence.service';
import { RealtimeService } from './realtime.service';

const driverUser = {
  id: 'user-d1',
  email: 'd1@x.com',
  roles: ['DRIVER'],
} as unknown as AuthenticatedUser;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Flushes the pending promise callbacks. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function build(prisma: Record<string, unknown>) {
  const service = new RealtimeService(
    {} as HttpAdapterHost,
    {} as JwtService,
    {} as SessionsService,
    prisma as unknown as PrismaService,
    {} as PresenceService,
    { corsOrigins: [] } as unknown as ReturnType<typeof appConfig>,
    {} as ReturnType<typeof authConfig>,
    { autoOffer: 'off' } as ReturnType<typeof matchingConfig>,
  );
  const emit = jest.fn();
  const io = { to: jest.fn(() => ({ emit })) };
  (service as unknown as { io: unknown }).io = io;
  return { service, io, emit };
}

function fakeSocket(user: AuthenticatedUser) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const socket = {
    data: { user },
    connected: true,
    join: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    }),
  };
  return { socket, handlers };
}

function connect(service: RealtimeService, socket: unknown): void {
  (
    service as unknown as { handleConnection(socket: Socket): void }
  ).handleConnection(socket as Socket);
}

describe('RealtimeService.emitOrderStatusChanged', () => {
  it('reaches the order room and the assigned drivers in one emit, without driverIds', () => {
    const { service, io, emit } = build({});

    service.emitOrderStatusChanged({
      orderId: 'order-1',
      status: 'CANCELLED',
      previousStatus: 'ACCEPTED',
      changedByUserId: 'user-op',
      changedAt: '2026-10-08T12:00:00.000Z',
      driverIds: ['d1', 'd2', 'd1'],
    });

    const expected = {
      orderId: 'order-1',
      status: 'CANCELLED',
      previousStatus: 'ACCEPTED',
      changedByUserId: 'user-op',
      changedAt: '2026-10-08T12:00:00.000Z',
    };
    // Una sola emision a todas las rooms: socket.io la deduplica por socket.
    expect(io.to).toHaveBeenNthCalledWith(1, [
      'order:order-1',
      'driver:d1',
      'driver:d2',
    ]);
    expect(io.to).toHaveBeenNthCalledWith(2, 'tracking:operations');
    expect(emit).toHaveBeenCalledTimes(2);
    for (const [event, payload] of emit.mock.calls) {
      expect(event).toBe('order.status.changed');
      expect(payload).toEqual(expected);
      expect(payload).not.toHaveProperty('driverIds');
    }
  });

  it('keeps the old rooms when no driver is given', () => {
    const { service, io, emit } = build({});

    service.emitOrderStatusChanged({
      orderId: 'order-1',
      status: 'REQUESTED',
      changedAt: '2026-10-08T12:00:00.000Z',
    });

    expect(io.to).toHaveBeenNthCalledWith(1, ['order:order-1']);
    expect(io.to).toHaveBeenNthCalledWith(2, 'tracking:operations');
    expect(emit).toHaveBeenCalledWith('order.status.changed', {
      orderId: 'order-1',
      status: 'REQUESTED',
      changedAt: '2026-10-08T12:00:00.000Z',
    });
  });
});

describe('RealtimeService.handleConnection', () => {
  it('registers every listener before the driver profile lookup resolves', () => {
    const lookup = deferred<{ id: string } | null>();
    const prisma = {
      driverProfile: { findFirst: jest.fn().mockReturnValue(lookup.promise) },
    };
    const { service } = build(prisma);
    const { socket, handlers } = fakeSocket(driverUser);

    connect(service, socket);

    // La app re-emite tracking:join-order apenas recibe 'connect'.
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        'tracking:join-order',
        'tracking:leave-order',
        'driver:presence',
        'tracking:driver-location',
      ]),
    );
    expect(socket.join).not.toHaveBeenCalledWith('driver:d1');
  });

  it('serves a join sent right after connect and then joins the driver rooms', async () => {
    const lookup = deferred<{ id: string } | null>();
    const prisma = {
      driverProfile: { findFirst: jest.fn().mockReturnValue(lookup.promise) },
      orderAssignment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'asg-1' }),
      },
    };
    const { service } = build(prisma);
    const { socket, handlers } = fakeSocket(driverUser);

    connect(service, socket);
    const joining = handlers.get('tracking:join-order')?.({
      orderId: 'order-1',
    });
    lookup.resolve({ id: 'd1' });
    await joining;
    await flush();

    expect(socket.join).toHaveBeenCalledWith('order:order-1');
    expect(socket.join).toHaveBeenCalledWith('driver:d1');
    expect(socket.join).toHaveBeenCalledWith('drivers:requests');
    // El perfil se consulta una vez por conexion, no una por orden.
    expect(prisma.driverProfile.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        driverId: 'd1',
        assignmentStatus: {
          in: [
            ASSIGNMENT_STATUS.PENDING,
            ASSIGNMENT_STATUS.ACCEPTED,
            ASSIGNMENT_STATUS.COMPLETED,
          ],
        },
      },
      select: { id: true },
    });
  });

  it('keeps a driver who no longer holds the order out of its room', async () => {
    // Solo tiene una asignacion REJECTED o CANCELLED: el filtro no la encuentra.
    const prisma = {
      driverProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'd1' }),
      },
      orderAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const { service } = build(prisma);
    const { socket, handlers } = fakeSocket(driverUser);

    connect(service, socket);
    await handlers.get('tracking:join-order')?.({ orderId: 'order-1' });
    await flush();

    const where = (
      prisma.orderAssignment.findFirst.mock.calls[0] as [
        { where: { assignmentStatus: { in: string[] } } },
      ]
    )[0].where;
    expect(where.assignmentStatus.in).not.toContain(ASSIGNMENT_STATUS.REJECTED);
    expect(where.assignmentStatus.in).not.toContain(
      ASSIGNMENT_STATUS.CANCELLED,
    );
    expect(socket.emit).toHaveBeenCalledWith('tracking:error', {
      message: 'Not authorized to watch this order',
    });
    expect(socket.join).not.toHaveBeenCalledWith('order:order-1');
  });

  it('reports a failed join instead of rejecting inside the listener', async () => {
    const prisma = {
      driverProfile: {
        findFirst: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    const { service } = build(prisma);
    const { socket, handlers } = fakeSocket(driverUser);

    connect(service, socket);
    await expect(
      handlers.get('tracking:join-order')?.({ orderId: 'order-1' }),
    ).resolves.toBeUndefined();
    await flush();

    expect(socket.emit).toHaveBeenCalledWith('tracking:error', {
      message: 'Could not join this order right now',
    });
    expect(socket.join).not.toHaveBeenCalledWith('order:order-1');
  });

  it('does not join the driver rooms once the socket is gone', async () => {
    const lookup = deferred<{ id: string } | null>();
    const prisma = {
      driverProfile: { findFirst: jest.fn().mockReturnValue(lookup.promise) },
    };
    const { service } = build(prisma);
    const { socket } = fakeSocket(driverUser);

    connect(service, socket);
    socket.connected = false;
    lookup.resolve({ id: 'd1' });
    await flush();

    expect(socket.join).not.toHaveBeenCalledWith('driver:d1');
  });
});
