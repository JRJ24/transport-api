import {
  ASSIGNMENT_STATUS,
  OFFER_MODE,
  OFFER_STATUS,
  ORDER_CANCELLATION,
  STATUS_DRIVER,
  STATUS_ORDERS,
  TRACKING_SESSIONS,
} from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { PrismaService } from '@/database/prisma.service';
import type { AssignmentsService } from '@/modules/operations/assignments/assignments.service';
import type { RealtimeService } from '@/modules/realtime/realtime.service';
import type { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import type { PricingService } from '../pricing/pricing.service';
import { OrdersService } from './orders.service';

const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;
const driverUser = { id: 'user-d1', roles: ['DRIVER'] } as AuthenticatedUser;
const customerUser = {
  id: 'user-c1',
  roles: ['CUSTOMER'],
} as AuthenticatedUser;

const LIVE = [ASSIGNMENT_STATUS.PENDING, ASSIGNMENT_STATUS.ACCEPTED];

/** Lo que pide assertDriverCanAccessOrder (driverReadableAssignment). */
const driverReadWhere = (orderId: string, userId: string) => ({
  orderId,
  driver: { userId },
  OR: [
    {
      assignmentStatus: {
        in: [
          ASSIGNMENT_STATUS.PENDING,
          ASSIGNMENT_STATUS.ACCEPTED,
          ASSIGNMENT_STATUS.COMPLETED,
        ],
      },
    },
    {
      assignmentStatus: ASSIGNMENT_STATUS.CANCELLED,
      order: {
        status: { in: [STATUS_ORDERS.CANCELLED, STATUS_ORDERS.FAILED] },
      },
    },
  ],
});

/** Asignacion de la orden como la devuelve ORDER_INCLUDE. */
const row = (
  driverId: string,
  assignmentStatus: ASSIGNMENT_STATUS,
  userId = `user-${driverId}`,
) => ({ driverId, assignmentStatus, driver: { userId } });

interface SetupOptions {
  status?: STATUS_ORDERS;
  /** Asignaciones vivas que encuentra la transaccion. */
  live?: { id: string; driverId: string }[];
  /** Asignaciones de la orden tal como se releen al final. */
  reread?: ReturnType<typeof row>[];
  offers?: Record<string, unknown>[];
}

/** Lo que processUploadedFiles deja para foto y firma (ambas webp). */
const PHOTO_URL = 'https://cdn.test/evidences/11-photo.webp';
const SIGNATURE_URL = 'https://cdn.test/evidences/22-signature-1.webp';

interface AttachmentRow {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
}

/**
 * attachment.findFirst que evalua el where de assertDeliveryEvidenceReady
 * sobre filas en memoria, para probar la regla y no solo la forma.
 */
function attachmentFinder(rows: AttachmentRow[]) {
  return jest.fn(
    ({
      where,
    }: {
      where: {
        entityType: string;
        entityId: { in: string[] };
        mimeType: { startsWith: string };
        NOT: [
          { fileName: { contains: string } },
          { fileUrl: { in: string[] } },
        ];
      };
    }) => {
      const [byName, byUrl] = where.NOT;
      const found = rows.find(
        (file) =>
          file.entityType === where.entityType &&
          where.entityId.in.includes(file.entityId) &&
          file.mimeType.startsWith(where.mimeType.startsWith) &&
          !file.fileName
            .toLowerCase()
            .includes(byName.fileName.contains.toLowerCase()) &&
          !byUrl.fileUrl.in.includes(file.fileUrl),
      );
      return Promise.resolve(found ? { id: found.id } : null);
    },
  );
}

const photoRow: AttachmentRow = {
  id: 'att-photo',
  entityType: 'DeliveryProof',
  entityId: 'proof-1',
  fileName: '11-photo.webp',
  fileUrl: PHOTO_URL,
  mimeType: 'image/webp',
};
const signatureRow: AttachmentRow = {
  id: 'att-signature',
  entityType: 'DeliveryProof',
  entityId: 'proof-1',
  fileName: '22-signature-1.webp',
  fileUrl: SIGNATURE_URL,
  mimeType: 'image/webp',
};

function setup(options: SetupOptions = {}) {
  const live = options.live ?? [{ id: 'asg-1', driverId: 'd1' }];
  const order = {
    id: 'order-1',
    orderCode: 'ORD-1',
    customerId: 'cust-1',
    status: options.status ?? STATUS_ORDERS.ACCEPTED,
    orderAssignments: options.reread ?? [],
  };
  const tx = {
    transportOrder: {
      update: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
    },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
    orderCancellation: { create: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    priceQuote: { update: jest.fn().mockResolvedValue({}) },
    orderAssignment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'asg-1', driverId: 'd1' }),
      findMany: jest.fn().mockResolvedValue(live),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: live.length }),
    },
    driverProfile: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    trackingSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    transportOrder: {
      findUnique: jest.fn().mockResolvedValue({
        status: options.status ?? STATUS_ORDERS.ACCEPTED,
        paymentStatus: 'PAID',
        customerId: 'cust-1',
      }),
      findFirst: jest.fn().mockResolvedValue({
        id: 'order-1',
        status: STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
        quoteId: null,
        totalAmount: 1500,
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    vehicle: { findMany: jest.fn().mockResolvedValue([]) },
    driverProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'd1' }) },
    orderAssignment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'asg-1' }),
    },
    driverOffer: {
      findMany: jest.fn().mockResolvedValue(options.offers ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    deliveryProof: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'proof-1', signatures: [{ signatureUrl: SIGNATURE_URL }] },
      ]),
    },
    attachment: { findFirst: attachmentFinder([photoRow, signatureRow]) },
    orderEvent: {
      findMany: jest.fn().mockResolvedValue([{ id: 'evt-1' }]),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    customerProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }),
    },
  };
  const realtime = {
    emitOrderStatusChanged: jest.fn(),
    emitOfferUpdated: jest.fn(),
    revokeOrderRoom: jest.fn(),
  };
  const notifications = { dispatch: jest.fn().mockResolvedValue(undefined) };

  const service = new OrdersService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeService,
    {} as AssignmentsService,
    notifications as unknown as NotificationDispatcherService,
    {} as PricingService,
  );
  return { service, prisma, tx, realtime };
}

/** Lo que una orden cancelada o fallida debe dejar hecho en la transaccion. */
function expectDriversReleased(tx: ReturnType<typeof setup>['tx']) {
  expect(tx.orderAssignment.findMany).toHaveBeenCalledWith({
    where: { orderId: 'order-1', assignmentStatus: { in: LIVE } },
    select: { id: true, driverId: true },
  });
  expect(tx.orderAssignment.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['asg-1'] }, assignmentStatus: { in: LIVE } },
    data: { assignmentStatus: ASSIGNMENT_STATUS.CANCELLED },
  });
  // Solo quien estaba BUSY y sin otro viaje vivo vuelve a AVAILABLE.
  expect(tx.driverProfile.updateMany).toHaveBeenCalledWith({
    where: {
      id: { in: ['d1'] },
      availabilityStatus: STATUS_DRIVER.BUSY,
      orderAssignments: {
        none: {
          orderId: { not: 'order-1' },
          assignmentStatus: { in: LIVE },
          order: {
            status: {
              in: [
                STATUS_ORDERS.ASSIGNED,
                STATUS_ORDERS.ACCEPTED,
                STATUS_ORDERS.IN_PROGRESS,
              ],
            },
          },
        },
      },
    },
    data: { availabilityStatus: STATUS_DRIVER.AVAILABLE },
  });
  expect(tx.trackingSession.updateMany).toHaveBeenCalledWith({
    where: { orderId: 'order-1', status: TRACKING_SESSIONS.ACTIVE },
    data: { status: TRACKING_SESSIONS.ENDED, endedAt: expect.any(Date) },
  });
  // La orden se bloquea antes de buscar asignaciones: un claim concurrente
  // espera y luego la ve cerrada.
  expect(tx.transportOrder.update.mock.invocationCallOrder[0]).toBeLessThan(
    tx.orderAssignment.findMany.mock.invocationCallOrder[0],
  );
}

/**
 * El conductor liberado sale de order:{id}, pero solo despues del aviso: la
 * cancelacion tiene que llegarle (por driver:{id}) antes de perder la room.
 */
function expectRoomRevokedAfterNotice(
  realtime: ReturnType<typeof setup>['realtime'],
  driverIds: string[],
) {
  expect(realtime.revokeOrderRoom).toHaveBeenCalledTimes(driverIds.length);
  driverIds.forEach((driverId, index) => {
    expect(realtime.revokeOrderRoom).toHaveBeenNthCalledWith(
      index + 1,
      driverId,
      'order-1',
    );
  });
  expect(
    realtime.emitOrderStatusChanged.mock.invocationCallOrder[0],
  ).toBeLessThan(realtime.revokeOrderRoom.mock.invocationCallOrder[0]);
}

describe('OrdersService realtime room revocation', () => {
  const dto = {
    cancellationType: ORDER_CANCELLATION.ADMIN_CANCELLED,
    reason: 'Cliente no responde',
  };

  it('cancel revokes the released driver after announcing the cancellation', async () => {
    const { service, realtime } = setup();

    await service.cancel(operator, 'order-1', dto);

    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ driverIds: ['d1'] }),
    );
    expectRoomRevokedAfterNotice(realtime, ['d1']);
  });

  it('cancel revokes nobody when no driver held the order', async () => {
    const { service, realtime } = setup({ live: [] });

    await service.cancel(operator, 'order-1', dto);

    expect(realtime.revokeOrderRoom).not.toHaveBeenCalled();
  });

  it('cancel revokes every released driver once', async () => {
    const { service, realtime } = setup({
      live: [
        { id: 'asg-1', driverId: 'd1' },
        { id: 'asg-2', driverId: 'd2' },
        { id: 'asg-3', driverId: 'd1' },
      ],
    });

    await service.cancel(operator, 'order-1', dto);

    expectRoomRevokedAfterNotice(realtime, ['d1', 'd2']);
  });

  it('updateStatus CANCELLED by staff revokes the released driver', async () => {
    const { service, realtime } = setup();

    await service.updateStatus(operator, 'order-1', {
      status: STATUS_ORDERS.CANCELLED,
    });

    expectRoomRevokedAfterNotice(realtime, ['d1']);
  });

  it('updateStatus FAILED by the driver revokes that driver after the notice', async () => {
    const { service, realtime } = setup({ status: STATUS_ORDERS.IN_PROGRESS });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.FAILED,
    });

    expectRoomRevokedAfterNotice(realtime, ['d1']);
  });

  it('keeps the room of the driver who delivers (COMPLETED still watches)', async () => {
    const { service, realtime } = setup({
      status: STATUS_ORDERS.IN_PROGRESS,
      reread: [row('d1', ASSIGNMENT_STATUS.COMPLETED)],
    });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.DELIVERED,
    });

    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ driverIds: ['d1'] }),
    );
    expect(realtime.revokeOrderRoom).not.toHaveBeenCalled();
  });

  it('keeps the room while the trip goes on', async () => {
    const { service, realtime } = setup({
      reread: [row('d1', ASSIGNMENT_STATUS.ACCEPTED)],
    });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.IN_PROGRESS,
    });

    expect(realtime.revokeOrderRoom).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancel', () => {
  const dto = {
    cancellationType: ORDER_CANCELLATION.ADMIN_CANCELLED,
    reason: ' Cliente no responde ',
  };

  it('closes the assignment, frees the driver and ends tracking in the same transaction', async () => {
    const { service, prisma, tx, realtime } = setup();

    await service.cancel(operator, 'order-1', dto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.transportOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: STATUS_ORDERS.CANCELLED },
    });
    expectDriversReleased(tx);
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        status: STATUS_ORDERS.CANCELLED,
        changedByUserId: 'user-op',
        driverIds: ['d1'],
      }),
    );
  });

  it('returns the order re-read after the assignments were cancelled', async () => {
    const { service, tx } = setup({
      reread: [
        row('d1', ASSIGNMENT_STATUS.CANCELLED),
      ],
    });

    const order = await service.cancel(operator, 'order-1', dto);

    expect(tx.transportOrder.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' } }),
    );
    expect(
      (order as unknown as { orderAssignments: unknown[] }).orderAssignments,
    ).toEqual([
      row('d1', ASSIGNMENT_STATUS.CANCELLED),
    ]);
  });

  it('only ends tracking when nobody held the order', async () => {
    const { service, tx, realtime } = setup({ live: [] });

    await service.cancel(operator, 'order-1', dto);

    expect(tx.orderAssignment.updateMany).not.toHaveBeenCalled();
    expect(tx.driverProfile.updateMany).not.toHaveBeenCalled();
    expect(tx.trackingSession.updateMany).toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ driverIds: [] }),
    );
  });

  it('cancels an open offer after the commit and tells the offered driver', async () => {
    const expiresAt = new Date('2026-10-08T12:00:30.000Z');
    const { service, prisma, tx, realtime } = setup({
      live: [],
      offers: [
        {
          id: 'offer-1',
          orderId: 'order-1',
          driverId: 'd7',
          mode: OFFER_MODE.AUTO,
          rank: 1,
          etaSeconds: 240,
          expiresAt,
        },
      ],
    });

    await service.cancel(operator, 'order-1', dto);

    expect(prisma.driverOffer.findMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1', status: OFFER_STATUS.PENDING },
    });
    expect(prisma.driverOffer.updateMany).toHaveBeenCalledWith({
      where: { id: 'offer-1', status: OFFER_STATUS.PENDING },
      data: expect.objectContaining({ status: OFFER_STATUS.CANCELLED }),
    });
    expect(tx.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.driverOffer.updateMany.mock.invocationCallOrder[0],
    );
    expect(realtime.emitOfferUpdated).toHaveBeenCalledWith({
      offerId: 'offer-1',
      orderId: 'order-1',
      driverId: 'd7',
      status: OFFER_STATUS.CANCELLED,
      mode: OFFER_MODE.AUTO,
      rank: 1,
      etaSeconds: 240,
      expiresAt: expiresAt.toISOString(),
    });
  });

  it('leaves alone an offer the driver answered meanwhile', async () => {
    const { service, prisma, realtime } = setup({
      live: [],
      offers: [{ id: 'offer-1', orderId: 'order-1', driverId: 'd7' }],
    });
    prisma.driverOffer.updateMany.mockResolvedValue({ count: 0 });

    await service.cancel(operator, 'order-1', dto);

    expect(realtime.emitOfferUpdated).not.toHaveBeenCalled();
  });

  it('still answers when closing the offers fails', async () => {
    const { service, prisma, realtime } = setup({ live: [] });
    prisma.driverOffer.findMany.mockRejectedValue(new Error('db down'));

    await expect(
      service.cancel(operator, 'order-1', dto),
    ).resolves.toMatchObject({ id: 'order-1' });
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalled();
  });
});

describe('OrdersService.updateStatus', () => {
  it('releases the driver when the operator cancels', async () => {
    const { service, tx, realtime } = setup();

    await service.updateStatus(operator, 'order-1', {
      status: STATUS_ORDERS.CANCELLED,
    });

    expectDriversReleased(tx);
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.CANCELLED,
        previousStatus: STATUS_ORDERS.ACCEPTED,
        driverIds: ['d1'],
      }),
    );
  });

  it('releases the driver who marks the trip FAILED', async () => {
    const { service, prisma, tx, realtime } = setup({
      status: STATUS_ORDERS.IN_PROGRESS,
    });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.FAILED,
    });

    expectDriversReleased(tx);
    expect(prisma.driverOffer.findMany).toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.FAILED,
        driverIds: ['d1'],
      }),
    );
  });

  it('leaves assignments and tracking alone while the trip goes on', async () => {
    const { service, prisma, tx, realtime } = setup({
      reread: [
        row('d1', ASSIGNMENT_STATUS.ACCEPTED),
        row('d0', ASSIGNMENT_STATUS.REJECTED),
      ],
    });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.IN_PROGRESS,
    });

    expect(tx.orderAssignment.findMany).not.toHaveBeenCalled();
    expect(tx.orderAssignment.updateMany).not.toHaveBeenCalled();
    expect(tx.trackingSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.driverOffer.findMany).not.toHaveBeenCalled();
    // Solo el conductor con la asignacion viva, no el que la rechazo.
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.IN_PROGRESS,
        driverIds: ['d1'],
      }),
    );
  });

  it('tells the driver whose assignment a delivery completes', async () => {
    const { service, tx, realtime } = setup({
      status: STATUS_ORDERS.IN_PROGRESS,
      reread: [
        row('d1', ASSIGNMENT_STATUS.COMPLETED),
      ],
    });

    await service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.DELIVERED,
    });

    expect(tx.orderAssignment.update).toHaveBeenCalledWith({
      where: { id: 'asg-1' },
      data: { assignmentStatus: ASSIGNMENT_STATUS.COMPLETED },
    });
    expect(tx.trackingSession.updateMany).not.toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        status: STATUS_ORDERS.DELIVERED,
        driverIds: ['d1'],
      }),
    );
  });
});

describe('OrdersService.confirmByCustomer', () => {
  it('announces the confirmation to the drivers of the order, if any', async () => {
    const { service, realtime } = setup({ reread: [] });

    await service.confirmByCustomer(customerUser, 'order-1');

    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        status: STATUS_ORDERS.PENDING_PAYMENT,
        previousStatus: STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
        driverIds: [],
      }),
    );
  });
});

describe('OrdersService.updateStatus driver authorization', () => {
  const HOLDER = [
    ASSIGNMENT_STATUS.ACCEPTED,
    ASSIGNMENT_STATUS.COMPLETED,
    ASSIGNMENT_STATUS.CANCELLED,
  ];

  it('refuses a driver who rejected the order another driver now holds', async () => {
    const { service, prisma, tx, realtime } = setup({
      status: STATUS_ORDERS.IN_PROGRESS,
    });
    // Su unica asignacion es la REJECTED: ya no pasa ni la regla de lectura.
    prisma.orderAssignment.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateStatus(driverUser, 'order-1', {
        status: STATUS_ORDERS.FAILED,
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: {
        code: 'FORBIDDEN',
        message: 'This order is not assigned to you',
      },
    });

    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: driverReadWhere('order-1', 'user-d1'),
      select: { id: true },
    });
    // Ni la orden ni la asignacion del otro conductor se tocan.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.orderAssignment.updateMany).not.toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).not.toHaveBeenCalled();
  });

  it('refuses a driver who can read the order but has not accepted it (PENDING)', async () => {
    const { service, prisma } = setup({ status: STATUS_ORDERS.ACCEPTED });
    // PENDING pasa la lectura, pero no es una asignacion con la que la lleve.
    prisma.orderAssignment.findFirst
      .mockResolvedValueOnce({ id: 'asg-pending' })
      .mockResolvedValueOnce(null);

    await expect(
      service.updateStatus(driverUser, 'order-1', {
        status: STATUS_ORDERS.IN_PROGRESS,
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: { message: 'This order is not assigned to you' },
    });
    expect(prisma.orderAssignment.findFirst).toHaveBeenLastCalledWith({
      where: {
        orderId: 'order-1',
        assignmentStatus: { in: HOLDER },
        driver: { userId: 'user-d1' },
      },
      select: { id: true },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets the released driver retry FAILED on the failed order (offline queue)', async () => {
    // Su asignacion quedo CANCELLED al marcar FAILED: la lectura la deja
    // pasar porque la orden misma esta FAILED, y la de escritura tambien.
    const { service, prisma } = setup({ status: STATUS_ORDERS.FAILED });

    await expect(
      service.updateStatus(driverUser, 'order-1', {
        status: STATUS_ORDERS.FAILED,
      }),
    ).resolves.toMatchObject({ id: 'order-1' });
    expect(prisma.orderAssignment.findFirst).toHaveBeenNthCalledWith(1, {
      where: driverReadWhere('order-1', 'user-d1'),
      select: { id: true },
    });
    expect(prisma.orderAssignment.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignmentStatus: { in: HOLDER } }),
      }),
    );
  });

  it('also refuses that driver repeating the current status', async () => {
    const { service, prisma } = setup({ status: STATUS_ORDERS.IN_PROGRESS });
    prisma.orderAssignment.findFirst.mockResolvedValueOnce(null);

    // Repetir IN_PROGRESS reescribia pickupAt y creaba otro evento.
    await expect(
      service.updateStatus(driverUser, 'order-1', {
        status: STATUS_ORDERS.IN_PROGRESS,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets the driver who delivered repeat DELIVERED (offline queue retry)', async () => {
    const { service, prisma } = setup({ status: STATUS_ORDERS.DELIVERED });

    await expect(
      service.updateStatus(driverUser, 'order-1', {
        status: STATUS_ORDERS.DELIVERED,
      }),
    ).resolves.toMatchObject({ id: 'order-1' });
    expect(prisma.orderAssignment.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignmentStatus: { in: HOLDER } }),
      }),
    );
  });

  it('does not ask staff for an assignment', async () => {
    const { service, prisma } = setup();

    await service.updateStatus(operator, 'order-1', {
      status: STATUS_ORDERS.CANCELLED,
    });

    expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
  });
});

/** Orden como la devuelve findUnique con ORDER_INCLUDE. */
function fullOrder(
  status: STATUS_ORDERS,
  orderAssignments: ReturnType<typeof row>[],
) {
  return { id: 'order-1', customerId: 'cust-1', status, orderAssignments };
}

describe('OrdersService.findOne driver read rule', () => {
  it('asks for a readable assignment: PENDING/ACCEPTED/COMPLETED, or CANCELLED on a closed order', async () => {
    const { service, prisma } = setup();
    prisma.transportOrder.findUnique.mockResolvedValue(
      fullOrder(STATUS_ORDERS.ACCEPTED, [row('d1', ASSIGNMENT_STATUS.ACCEPTED)]),
    );

    await service.findOne(driverUser, 'order-1');

    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: driverReadWhere('order-1', 'user-d1'),
      select: { id: true },
    });
    // Un solo filtro por relacion: ya no se busca antes el perfil.
    expect(prisma.driverProfile.findFirst).not.toHaveBeenCalled();
    expect(
      JSON.stringify(prisma.orderAssignment.findFirst.mock.calls[0]),
    ).not.toContain(ASSIGNMENT_STATUS.REJECTED);
  });

  it('answers 403 to a driver whose only assignment was REJECTED', async () => {
    const { service, prisma } = setup();
    prisma.transportOrder.findUnique.mockResolvedValue(
      fullOrder(STATUS_ORDERS.IN_PROGRESS, [
        row('d1', ASSIGNMENT_STATUS.REJECTED),
        row('d2', ASSIGNMENT_STATUS.ACCEPTED),
      ]),
    );
    prisma.orderAssignment.findFirst.mockResolvedValue(null);

    await expect(service.findOne(driverUser, 'order-1')).rejects.toMatchObject({
      status: 403,
      response: {
        code: 'FORBIDDEN',
        message: 'This order is not assigned to you',
      },
    });
  });

  it('lets the released driver re-read the order right after it was cancelled', async () => {
    // transport-driver recarga GET /orders/:id al recibir order.status.changed.
    const { service, prisma } = setup();
    prisma.transportOrder.findUnique.mockResolvedValue(
      fullOrder(STATUS_ORDERS.CANCELLED, [
        row('d1', ASSIGNMENT_STATUS.CANCELLED),
      ]),
    );

    await expect(service.findOne(driverUser, 'order-1')).resolves.toMatchObject(
      { id: 'order-1', status: STATUS_ORDERS.CANCELLED },
    );
  });

  it('shows a driver only their own assignment, not the other drivers contact', async () => {
    const { service, prisma } = setup();
    prisma.transportOrder.findUnique.mockResolvedValue(
      fullOrder(STATUS_ORDERS.ACCEPTED, [
        row('d0', ASSIGNMENT_STATUS.REJECTED),
        row('d1', ASSIGNMENT_STATUS.ACCEPTED),
      ]),
    );

    const order = await service.findOne(driverUser, 'order-1');

    expect(
      (order as unknown as { orderAssignments: unknown[] }).orderAssignments,
    ).toEqual([row('d1', ASSIGNMENT_STATUS.ACCEPTED)]);
  });

  it('keeps every assignment for staff and for the customer', async () => {
    const { service, prisma } = setup();
    const assignments = [
      row('d0', ASSIGNMENT_STATUS.REJECTED),
      row('d1', ASSIGNMENT_STATUS.ACCEPTED),
    ];
    prisma.transportOrder.findUnique.mockResolvedValue(
      fullOrder(STATUS_ORDERS.ACCEPTED, assignments),
    );

    for (const user of [operator, customerUser]) {
      const order = await service.findOne(user, 'order-1');
      expect(
        (order as unknown as { orderAssignments: unknown[] }).orderAssignments,
      ).toEqual(assignments);
    }
    expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
  });
});

describe('OrdersService.findAll for drivers', () => {
  it('lists only orders with a readable assignment and hides other drivers', async () => {
    const { service, prisma } = setup();
    prisma.transportOrder.findMany.mockResolvedValue([
      fullOrder(STATUS_ORDERS.ACCEPTED, [
        row('d0', ASSIGNMENT_STATUS.REJECTED),
        row('d1', ASSIGNMENT_STATUS.ACCEPTED),
      ]),
    ]);

    const orders = await service.findAll(driverUser, {} as never);

    const [{ where }] = prisma.transportOrder.findMany.mock.calls[0] as [
      { where: { orderAssignments: unknown } },
    ];
    const { orderId: _orderId, ...readable } = driverReadWhere(
      'order-1',
      'user-d1',
    );
    expect(where.orderAssignments).toEqual({ some: readable });
    expect(prisma.driverProfile.findFirst).not.toHaveBeenCalled();
    expect(
      (orders[0] as unknown as { orderAssignments: unknown[] })
        .orderAssignments,
    ).toEqual([row('d1', ASSIGNMENT_STATUS.ACCEPTED)]);
  });

  it('leaves the staff listing untouched', async () => {
    const { service, prisma } = setup();
    const assignments = [
      row('d0', ASSIGNMENT_STATUS.REJECTED),
      row('d1', ASSIGNMENT_STATUS.ACCEPTED),
    ];
    prisma.transportOrder.findMany.mockResolvedValue([
      fullOrder(STATUS_ORDERS.ACCEPTED, assignments),
    ]);

    const orders = await service.findAll(operator, {
      driverId: 'd1',
    } as never);

    const [{ where }] = prisma.transportOrder.findMany.mock.calls[0] as [
      { where: { orderAssignments: unknown } },
    ];
    expect(where.orderAssignments).toEqual({ some: { driverId: 'd1' } });
    expect(
      (orders[0] as unknown as { orderAssignments: unknown[] })
        .orderAssignments,
    ).toEqual(assignments);
  });
});

describe('OrdersService.findAvailableForDrivers', () => {
  it('does not hand the job board the contact of drivers who rejected the order', async () => {
    const { prisma, realtime } = setup();
    prisma.driverProfile.findFirst.mockResolvedValue({
      id: 'd1',
      availabilityStatus: STATUS_DRIVER.AVAILABLE,
      verificationStatus: 'APPROVED',
      licenseExpiration: new Date(Date.now() + 86_400_000),
    } as never);
    prisma.orderAssignment.findFirst.mockResolvedValue(null);
    prisma.vehicle.findMany.mockResolvedValue([{ categoryId: 'cat-1' }]);
    prisma.transportOrder.findMany.mockResolvedValue([
      fullOrder(STATUS_ORDERS.REQUESTED, [
        row('d0', ASSIGNMENT_STATUS.REJECTED),
        row('d9', ASSIGNMENT_STATUS.CANCELLED),
      ]),
    ]);
    const service = new OrdersService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
      { selfDispatchEnabled: true } as AssignmentsService,
      {} as NotificationDispatcherService,
      {} as PricingService,
    );

    const orders = await service.findAvailableForDrivers(driverUser);

    expect(orders).toHaveLength(1);
    expect(
      (orders[0] as unknown as { orderAssignments: unknown[] })
        .orderAssignments,
    ).toEqual([]);
  });
});

describe('OrdersService.listEvents ownership', () => {
  it('serves the timeline to the customer who owns the order', async () => {
    const { service, prisma } = setup();

    await expect(
      service.listEvents(customerUser, 'order-1'),
    ).resolves.toEqual([{ id: 'evt-1' }]);
    expect(prisma.transportOrder.findUnique).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      select: { customerId: true },
    });
    expect(prisma.orderEvent.findMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('answers 403 to a customer asking for another customer order', async () => {
    const { service, prisma } = setup();
    prisma.customerProfile.findFirst.mockResolvedValue({ id: 'cust-2' });

    await expect(
      service.listEvents(customerUser, 'order-1'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'FORBIDDEN', message: 'You cannot access this order' },
    });
    expect(prisma.orderEvent.findMany).not.toHaveBeenCalled();
  });

  it('answers a customer the same 403 for an order that does not exist', async () => {
    const { service, prisma } = setup();
    prisma.transportOrder.findUnique.mockResolvedValue(null as never);

    await expect(
      service.listEvents(customerUser, 'order-404'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'FORBIDDEN', message: 'You cannot access this order' },
    });
    expect(prisma.orderEvent.findMany).not.toHaveBeenCalled();
  });

  it('serves the timeline to a driver with a readable assignment', async () => {
    const { service, prisma } = setup();

    await expect(service.listEvents(driverUser, 'order-1')).resolves.toEqual([
      { id: 'evt-1' },
    ]);
    expect(prisma.orderAssignment.findFirst).toHaveBeenCalledWith({
      where: driverReadWhere('order-1', 'user-d1'),
      select: { id: true },
    });
  });

  it('answers 403 to a driver without a readable assignment (e.g. REJECTED)', async () => {
    const { service, prisma } = setup();
    prisma.orderAssignment.findFirst.mockResolvedValue(null);

    await expect(
      service.listEvents(driverUser, 'order-1'),
    ).rejects.toMatchObject({
      status: 403,
      response: {
        code: 'FORBIDDEN',
        message: 'This order is not assigned to you',
      },
    });
    expect(prisma.orderEvent.findMany).not.toHaveBeenCalled();
  });

  it('answers a driver the same 403 for an order that does not exist', async () => {
    const { service, prisma } = setup();
    prisma.transportOrder.findUnique.mockResolvedValue(null as never);
    prisma.orderAssignment.findFirst.mockResolvedValue(null);

    await expect(
      service.listEvents(driverUser, 'order-404'),
    ).rejects.toMatchObject({
      status: 403,
      response: { message: 'This order is not assigned to you' },
    });
    expect(prisma.orderEvent.findMany).not.toHaveBeenCalled();
  });

  it('keeps staff unrestricted, without extra lookups', async () => {
    const { service, prisma } = setup();

    await expect(service.listEvents(operator, 'order-1')).resolves.toEqual([
      { id: 'evt-1' },
    ]);
    expect(prisma.transportOrder.findUnique).not.toHaveBeenCalled();
    expect(prisma.orderAssignment.findFirst).not.toHaveBeenCalled();
  });
});

describe('OrdersService delivery evidence', () => {
  const deliver = (service: OrdersService) =>
    service.updateStatus(driverUser, 'order-1', {
      status: STATUS_ORDERS.DELIVERED,
    });
  const MISSING =
    'Delivery photo and recipient signature are required before completing the order';

  it('accepts a photo and a signature uploaded as separate files (both driver apps)', async () => {
    const { service, prisma } = setup({ status: STATUS_ORDERS.IN_PROGRESS });

    await expect(deliver(service)).resolves.toMatchObject({ id: 'order-1' });
    expect(prisma.deliveryProof.findMany).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      select: { id: true, signatures: { select: { signatureUrl: true } } },
    });
    expect(prisma.attachment.findFirst).toHaveBeenCalledWith({
      where: {
        entityType: 'DeliveryProof',
        entityId: { in: ['proof-1'] },
        mimeType: { startsWith: 'image/' },
        NOT: [
          { fileName: { contains: 'signature', mode: 'insensitive' } },
          { fileUrl: { in: [SIGNATURE_URL] } },
        ],
      },
      select: { id: true },
    });
  });

  it('refuses one uploaded photo registered also as the signature', async () => {
    const { service, prisma } = setup({ status: STATUS_ORDERS.IN_PROGRESS });
    prisma.deliveryProof.findMany.mockResolvedValue([
      { id: 'proof-1', signatures: [{ signatureUrl: PHOTO_URL }] },
    ]);
    prisma.attachment.findFirst = attachmentFinder([photoRow]);

    await expect(deliver(service)).rejects.toMatchObject({
      status: 400,
      response: { code: 'BAD_REQUEST', message: MISSING },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses it even when a file named signature was uploaded next to it', async () => {
    // La foto es la "firma"; el archivo llamado signature no cuenta como foto.
    const { service, prisma } = setup({ status: STATUS_ORDERS.IN_PROGRESS });
    prisma.deliveryProof.findMany.mockResolvedValue([
      { id: 'proof-1', signatures: [{ signatureUrl: PHOTO_URL }] },
    ]);

    await expect(deliver(service)).rejects.toMatchObject({
      status: 400,
      response: { message: MISSING },
    });
  });

  it('excludes the signatures of every proof of the order', async () => {
    const { service, prisma } = setup({ status: STATUS_ORDERS.IN_PROGRESS });
    prisma.deliveryProof.findMany.mockResolvedValue([
      { id: 'proof-1', signatures: [{ signatureUrl: PHOTO_URL }] },
      { id: 'proof-2', signatures: [] },
    ]);
    prisma.attachment.findFirst = attachmentFinder([
      { ...photoRow, entityId: 'proof-2' },
    ]);

    await expect(deliver(service)).rejects.toMatchObject({ status: 400 });
  });

  it('refuses without a signature, without looking for the photo', async () => {
    const { service, prisma } = setup({ status: STATUS_ORDERS.IN_PROGRESS });
    prisma.deliveryProof.findMany.mockResolvedValue([
      { id: 'proof-1', signatures: [] },
    ]);

    await expect(deliver(service)).rejects.toMatchObject({
      status: 400,
      response: { message: MISSING },
    });
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
  });

  it('refuses without any delivery proof', async () => {
    const { service, prisma } = setup({ status: STATUS_ORDERS.IN_PROGRESS });
    prisma.deliveryProof.findMany.mockResolvedValue([]);

    await expect(deliver(service)).rejects.toMatchObject({
      status: 400,
      response: {
        message: 'Delivery evidence is required before completing the order',
      },
    });
  });
});
