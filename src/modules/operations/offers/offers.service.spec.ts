import { BadRequestException, ConflictException } from '@nestjs/common';
import RedisMock from 'ioredis-mock';
import { OFFER_MODE, OFFER_STATUS } from '@generated/prisma/enums';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { matchingConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import type { RedisService } from '@/database/redis.service';
import type { RealtimeService } from '@/modules/realtime/realtime.service';
import type { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import type {
  AssignmentsService,
  ClaimHooks,
} from '../assignments/assignments.service';
import type { MatchingService } from '../matching/matching.service';
import type {
  MatchingResult,
  RankedCandidate,
} from '../matching/matching.types';
import type { OfferSchedulerService } from './offer-scheduler.service';
import { OffersService } from './offers.service';

const config = {
  autoOffer: 'on',
  offerTtlSec: 30,
  manualEnforce: 'on',
  retryCooldownSec: 60,
  scoreVersion: 'v-test',
} as ReturnType<typeof matchingConfig>;

const driverUser = { id: 'user-d1', roles: ['DRIVER'] } as AuthenticatedUser;
const operator = { id: 'user-op', roles: ['OPERATOR'] } as AuthenticatedUser;

function candidate(driverId: string, rank: number): RankedCandidate {
  return {
    rank,
    driverId,
    driverName: driverId,
    vehicleId: `veh-${driverId}`,
    plateNumber: null,
    vehicleCategoryId: 'cat',
    etaSeconds: 300 * rank,
    etaStatus: 'OK',
    roadDistanceMeters: 2000 * rank,
    straightLineMeters: 1500 * rank,
    positionAgeSec: 5,
    positionObservedAt: new Date().toISOString(),
    accuracyM: 8,
    h3Cell: '88283082a3fffff',
    ring: 0,
    score: 1 - rank / 10,
    scoreBreakdown: { eta: 0.9, distance: 0.8, reliability: 0.9, balance: 1 },
    rating: 4.8,
    acceptanceRate: null,
    tripsToday: 0,
  };
}

function ranking(
  candidates: RankedCandidate[],
  extra: Partial<MatchingResult> = {},
): MatchingResult {
  return {
    orderId: 'order-1',
    pickup: { latitude: 18.47, longitude: -69.94, h3Cell: 'x' },
    h3Resolution: 8,
    ringsSearched: 1,
    scoreVersion: 'v-test',
    weights: { eta: 0.55, distance: 0.15, reliability: 0.15, balance: 0.15 },
    etaProvider: 'google-routes',
    computedAt: new Date().toISOString(),
    candidates,
    excluded: [],
    alerts: [],
    ...extra,
  };
}

async function setup(rank: MatchingResult) {
  const client = new RedisMock();
  await client.flushall();
  const offerUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    driverProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'd1' }),
      findUnique: jest.fn().mockResolvedValue({ userId: 'user-d1' }),
    },
    transportOrder: {
      findUnique: jest.fn().mockResolvedValue({
        orderCode: 'RD-1',
        status: 'REQUESTED',
        paymentStatus: 'PAID',
      }),
      // isWaitingForOffer: the order is paid, driverless and has no offer.
      findFirst: jest.fn().mockResolvedValue({ id: 'order-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    driverOffer: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'offer-1',
        orderId: 'order-1',
        driverId: 'd1',
        vehicleId: 'veh-d1',
        status: OFFER_STATUS.PENDING,
        mode: OFFER_MODE.AUTO,
        rank: 1,
        etaSeconds: 300,
        expiresAt: new Date(Date.now() + 30_000),
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'offer-1',
        orderId: 'order-1',
        driverId: 'd1',
        status: OFFER_STATUS.REJECTED,
        mode: OFFER_MODE.AUTO,
        rank: 1,
        etaSeconds: 300,
        expiresAt: null,
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => ({
        id: 'offer-new',
        ...data,
      })),
      updateMany: offerUpdateMany,
      update: jest.fn(),
    },
  } as unknown as PrismaService;

  const matching = {
    rankForOrder: jest.fn().mockResolvedValue(rank),
    emitAlert: jest.fn(),
  } as unknown as MatchingService;
  const assignments = {
    create: jest.fn().mockResolvedValue({ id: 'asg-1' }),
    claimOrder: jest.fn(
      async (
        _user: AuthenticatedUser,
        _orderId: string,
        _vehicleId: string,
        hooks: ClaimHooks,
      ) => {
        const tx = prisma as never;
        await hooks.beforeClaim?.(tx);
        const created = { id: 'asg-1' } as never;
        await hooks.afterClaim?.(tx, created);
        return created;
      },
    ),
  } as unknown as AssignmentsService;
  const realtime = {
    emitOfferUpdated: jest.fn(),
    emitMatchingStatus: jest.fn(),
    emitOrderStatusChanged: jest.fn(),
  } as unknown as RealtimeService;
  const notifications = {
    dispatch: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationDispatcherService;
  const scheduler = {
    scheduleExpiry: jest.fn().mockResolvedValue(undefined),
  } as unknown as OfferSchedulerService;

  const service = new OffersService(
    prisma,
    { client, isEnabled: true } as unknown as RedisService,
    matching,
    assignments,
    realtime,
    notifications,
    scheduler,
    config,
  );
  return {
    service,
    prisma,
    matching,
    assignments,
    scheduler,
    realtime,
    client,
    offerUpdateMany,
  };
}

describe('OffersService.offerNext', () => {
  it('offers the order to the top candidate with a deadline', async () => {
    const { service, prisma, scheduler } = await setup(
      ranking([candidate('d1', 1), candidate('d2', 2)]),
    );

    const offer = await service.offerNext('order-1');

    expect(prisma.driverOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        driverId: 'd1',
        mode: OFFER_MODE.AUTO,
        status: OFFER_STATUS.PENDING,
        scoreVersion: 'v-test',
      }),
    });
    expect(offer?.driverId).toBe('d1');
    expect(scheduler.scheduleExpiry).toHaveBeenCalledWith('offer-new', 30);
  });

  it('skips drivers already offered this order', async () => {
    const { service, prisma, matching } = await setup(
      ranking([candidate('d2', 1)]),
    );
    (prisma.driverOffer.findMany as jest.Mock).mockResolvedValue([
      { driverId: 'd1' },
    ]);

    await service.offerNext('order-1');

    expect(matching.rankForOrder).toHaveBeenCalledWith('order-1', {
      excludeDriverIds: ['d1'],
    });
  });

  it('alerts and cools down when the cascade runs out of drivers', async () => {
    const { service, matching, client, prisma } = await setup(
      ranking([], { alerts: ['NO_CANDIDATES'] }),
    );
    (prisma.driverOffer.findMany as jest.Mock).mockResolvedValue([
      { driverId: 'd1' },
    ]);

    expect(await service.offerNext('order-1')).toBeNull();
    expect(matching.emitAlert).toHaveBeenCalledWith('order-1', [
      'NO_CANDIDATES',
      'CASCADE_EXHAUSTED',
    ]);
    expect(await client.exists('matching:cooldown:order-1')).toBe(1);

    // During the cooldown the order is not re-ranked.
    await service.offerNext('order-1');
    expect(matching.rankForOrder).toHaveBeenCalledTimes(1);
  });

  it('backs off quietly when another worker opened an offer first', async () => {
    const { service, prisma, scheduler } = await setup(
      ranking([candidate('d1', 1)]),
    );
    (prisma.driverOffer.create as jest.Mock).mockRejectedValue({
      code: 'P2002',
    });

    expect(await service.offerNext('order-1')).toBeNull();
    expect(scheduler.scheduleExpiry).not.toHaveBeenCalled();
  });
});

describe('OffersService.accept', () => {
  it('confirms the assignment inside the claim transaction', async () => {
    const { service, assignments, prisma } = await setup(ranking([]));

    await service.accept(driverUser, 'offer-1');

    expect(assignments.claimOrder).toHaveBeenCalledWith(
      driverUser,
      'order-1',
      'veh-d1',
      expect.objectContaining({ viaOffer: true }),
    );
    expect(prisma.driverOffer.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: { assignmentId: 'asg-1' },
    });
  });

  it('refuses an offer that expired or was answered meanwhile', async () => {
    const { service, offerUpdateMany, prisma } = await setup(ranking([]));
    offerUpdateMany.mockResolvedValue({ count: 0 });

    await expect(service.accept(driverUser, 'offer-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.driverOffer.update).not.toHaveBeenCalled();
  });

  it('lets exactly one of two simultaneous accepts through', async () => {
    const { service, offerUpdateMany } = await setup(ranking([]));
    // The database's compare-and-set: the first update wins, the second sees
    // the row already ACCEPTED.
    offerUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const results = await Promise.allSettled([
      service.accept(driverUser, 'offer-1'),
      service.accept(driverUser, 'offer-1'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

describe('OffersService.reject', () => {
  it('records the answer and moves on to the next driver', async () => {
    const { service, matching } = await setup(ranking([candidate('d2', 1)]));

    await service.reject(driverUser, 'offer-1', 'Muy lejos');
    await new Promise((resolve) => setImmediate(resolve));

    expect(matching.rankForOrder).toHaveBeenCalled();
  });
});

describe('OffersService.manualAssign', () => {
  it('requires a reason when the operator skips the top candidate', async () => {
    const { service, assignments } = await setup(
      ranking([candidate('d1', 1), candidate('d2', 2)]),
    );

    await expect(
      service.manualAssign(operator, 'order-1', { driverId: 'd2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assignments.create).not.toHaveBeenCalled();
  });

  it('assigns and audits a justified pick', async () => {
    const { service, assignments, prisma } = await setup(
      ranking([candidate('d1', 1), candidate('d2', 2)]),
    );

    await service.manualAssign(operator, 'order-1', {
      driverId: 'd2',
      reason: 'Cliente pidió al mismo conductor',
    });

    expect(assignments.create).toHaveBeenCalledWith(operator, {
      orderId: 'order-1',
      driverId: 'd2',
      vehicleId: 'veh-d2',
    });
    expect(prisma.driverOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mode: OFFER_MODE.MANUAL,
        actorUserId: 'user-op',
        reason: 'Cliente pidió al mismo conductor',
        rank: 2,
        assignmentId: 'asg-1',
      }),
    });
  });

  it('refuses an excluded driver when enforcement is on', async () => {
    const { service } = await setup(
      ranking([candidate('d1', 1)], {
        excluded: [
          {
            driverId: 'd9',
            driverName: null,
            reason: 'POSITION_STALE',
            ring: 1,
            positionAgeSec: 300,
          },
        ],
      }),
    );

    await expect(
      service.manualAssign(operator, 'order-1', {
        driverId: 'd9',
        vehicleId: 'veh-d9',
        reason: 'x',
      }),
    ).rejects.toThrow(/POSITION_STALE/);
  });
});

describe('OffersService order status while dispatching', () => {
  it('marks the order ASSIGNING_DRIVER while an offer is open', async () => {
    const { service, prisma, realtime } = await setup(
      ranking([candidate('d1', 1)]),
    );

    await service.offerNext('order-1');

    expect(prisma.transportOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'REQUESTED' },
      data: { status: 'ASSIGNING_DRIVER' },
    });
    expect(realtime.emitMatchingStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-1',
        state: 'OFFERING',
        attempt: 1,
      }),
    );
  });

  it('puts the order back in the queue when nobody is left', async () => {
    const { service, prisma, realtime } = await setup(ranking([]));

    await service.offerNext('order-1');

    expect(prisma.transportOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'ASSIGNING_DRIVER' },
      data: { status: 'REQUESTED' },
    });
    expect(realtime.emitMatchingStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'NO_DRIVERS' }),
    );
  });

  it('does not offer an order that is no longer waiting', async () => {
    const { service, prisma, matching } = await setup(
      ranking([candidate('d1', 1)]),
    );
    (prisma.transportOrder.findFirst as jest.Mock).mockResolvedValue(null);

    expect(await service.offerNext('order-1')).toBeNull();
    expect(matching.rankForOrder).not.toHaveBeenCalled();
  });
});

describe('OffersService.onOrderDispatchable', () => {
  it('announces the paid order and offers it at once', async () => {
    const { service, prisma, realtime } = await setup(
      ranking([candidate('d1', 1)]),
    );

    await service.onOrderDispatchable('order-1');

    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', status: 'REQUESTED' }),
    );
    expect(prisma.driverOffer.create).toHaveBeenCalled();
  });

  it('ignores an order whose payment did not stick', async () => {
    const { service, prisma, realtime } = await setup(
      ranking([candidate('d1', 1)]),
    );
    (prisma.transportOrder.findUnique as jest.Mock).mockResolvedValue({
      status: 'PENDING_PAYMENT',
      paymentStatus: 'PENDING',
    });

    await service.onOrderDispatchable('order-1');

    expect(realtime.emitOrderStatusChanged).not.toHaveBeenCalled();
    expect(prisma.driverOffer.create).not.toHaveBeenCalled();
  });
});
