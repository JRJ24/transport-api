import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type {
  DriverOffer,
  OrderAssignment,
  Prisma,
} from '@generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  OFFER_MODE,
  OFFER_STATUS,
  PAYMENT_STATUS,
  SERVICE_TYPE,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { DISPATCH_WAITING_STATUSES } from '@/common/constants/order-status.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { matchingConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { RedisService } from '@/database/redis.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { MatchingService } from '../matching/matching.service';
import type {
  MatchingResult,
  RankedCandidate,
} from '../matching/matching.types';
import { OfferSchedulerService } from './offer-scheduler.service';
import { RuntimeSettingsService } from '@/modules/administration/settings/runtime-settings.service';

const DISPATCHABLE_PAYMENT_STATUSES: PAYMENT_STATUS[] = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.AUTHORIZED,
];
/** Scheduled orders enter the automatic cascade this long before pickup. */
const SCHEDULED_LEAD_MS = 30 * 60_000;
const cooldownKey = (orderId: string) => `matching:cooldown:${orderId}`;

export interface ManualAssignInput {
  driverId: string;
  vehicleId?: string;
  reason?: string;
}

/**
 * Dispatch offers: the automatic cascade (best candidate first, next one on
 * reject or timeout) and the audited manual pick from the TMS.
 *
 * Every state change is a compare-and-set on the offer row, and the partial
 * unique index "one PENDING offer per order" backs it up in the database, so
 * two drivers can never hold, or accept, the same order.
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly matching: MatchingService,
    private readonly assignments: AssignmentsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationDispatcherService,
    private readonly scheduler: OfferSchedulerService,
    @Inject(matchingConfig.KEY)
    private readonly config: ConfigType<typeof matchingConfig>,
    @Optional() private readonly settings?: RuntimeSettingsService,
  ) {}

  /** Editable from Configuración; the env value is the default. */
  get autoEnabled(): boolean {
    const on =
      this.settings?.get('matching.auto_offer') ??
      this.config.autoOffer === 'on';
    return on && this.redis.isEnabled;
  }

  private get offerTtlSec(): number {
    return (
      this.settings?.get('matching.offer_ttl_sec') ?? this.config.offerTtlSec
    );
  }

  listForOrder(orderId: string): Promise<DriverOffer[]> {
    return this.prisma.driverOffer.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listMinePending(user: AuthenticatedUser): Promise<DriverOffer[]> {
    const driver = await this.driverOf(user);
    return this.prisma.driverOffer.findMany({
      where: {
        driverId: driver.id,
        status: OFFER_STATUS.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: { order: { include: { orderStops: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Automatic cascade ──────────────────────────────────────────────────────

  /**
   * One pass of the automatic dispatcher: expire what is due, cancel offers
   * for orders that moved on, and open an offer for every dispatchable order
   * without one. Run periodically by the scheduler (a single BullMQ worker),
   * so it is also the retry path for orders nobody could take.
   */
  async sweep(now = new Date()): Promise<void> {
    await this.expireDue(now);
    await this.cancelStale();

    if (!this.autoEnabled) {
      return;
    }

    // An order left in ASSIGNING_DRIVER without an open offer (crash between
    // two steps, lost job) goes back to the queue instead of hanging there.
    await this.prisma.transportOrder.updateMany({
      where: {
        status: STATUS_ORDERS.ASSIGNING_DRIVER,
        driverOffers: { none: { status: OFFER_STATUS.PENDING } },
      },
      data: { status: STATUS_ORDERS.REQUESTED },
    });

    const orders = await this.prisma.transportOrder.findMany({
      where: {
        status: STATUS_ORDERS.REQUESTED,
        paymentStatus: { in: DISPATCHABLE_PAYMENT_STATUSES },
        orderAssignments: {
          none: {
            assignmentStatus: {
              in: [ASSIGNMENT_STATUS.PENDING, ASSIGNMENT_STATUS.ACCEPTED],
            },
          },
        },
        driverOffers: { none: { status: OFFER_STATUS.PENDING } },
        OR: [
          { serviceType: SERVICE_TYPE.INMEDIATE },
          {
            serviceType: SERVICE_TYPE.SCHEDULED,
            scheduleAt: { lte: new Date(now.getTime() + SCHEDULED_LEAD_MS) },
          },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    for (const order of orders) {
      try {
        await this.offerNext(order.id);
      } catch (error) {
        this.logger.error(
          `Auto dispatch failed for order ${order.id}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
  }

  /**
   * Offers the order to the best-ranked driver not offered yet. When nobody is
   * left, operations are alerted and the order waits for the TMS or the next
   * retry once the cooldown ends.
   */
  async offerNext(orderId: string): Promise<DriverOffer | null> {
    const redis = this.redis.client;
    if (!this.autoEnabled || !redis) {
      return null;
    }
    if (await redis.exists(cooldownKey(orderId))) {
      return null;
    }
    if (!(await this.isWaitingForOffer(orderId))) {
      return null;
    }

    const previous = await this.prisma.driverOffer.findMany({
      where: { orderId },
      select: { driverId: true },
    });
    const ranking = await this.matching.rankForOrder(orderId, {
      excludeDriverIds: previous.map((offer) => offer.driverId),
    });
    const best = ranking.candidates.find(
      (candidate) => candidate.etaStatus === 'OK',
    );

    if (!best) {
      await redis.set(
        cooldownKey(orderId),
        '1',
        'EX',
        this.config.retryCooldownSec,
      );
      this.matching.emitAlert(orderId, [
        ...ranking.alerts,
        ...(previous.length > 0 ? ['CASCADE_EXHAUSTED'] : []),
      ]);
      await this.setWaitingStatus(
        orderId,
        STATUS_ORDERS.ASSIGNING_DRIVER,
        STATUS_ORDERS.REQUESTED,
      );
      this.realtime.emitMatchingStatus({
        orderId,
        state: 'NO_DRIVERS',
        attempt: previous.length,
        at: new Date().toISOString(),
      });
      return null;
    }

    const expiresAt = new Date(Date.now() + this.offerTtlSec * 1000);
    let offer: DriverOffer;
    try {
      offer = await this.prisma.driverOffer.create({
        data: {
          orderId,
          driverId: best.driverId,
          vehicleId: best.vehicleId,
          rank: best.rank,
          score: best.score,
          etaSeconds: best.etaSeconds,
          scoreVersion: ranking.scoreVersion,
          mode: OFFER_MODE.AUTO,
          status: OFFER_STATUS.PENDING,
          expiresAt,
          snapshot: snapshotOf(best, ranking.weights),
        },
      });
    } catch (error) {
      // P2002 on the partial unique index: another sweep got there first.
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }

    await this.scheduler.scheduleExpiry(offer.id, this.offerTtlSec);
    await this.setWaitingStatus(
      orderId,
      STATUS_ORDERS.REQUESTED,
      STATUS_ORDERS.ASSIGNING_DRIVER,
    );
    this.announce(offer);
    this.realtime.emitMatchingStatus({
      orderId,
      state: 'OFFERING',
      attempt: previous.length + 1,
      etaSeconds: offer.etaSeconds,
      expiresAt: offer.expiresAt?.toISOString() ?? null,
      at: new Date().toISOString(),
    });
    void this.notifyDriver(offer).catch((error: unknown) =>
      this.logger.error(
        `Failed to notify driver of offer: ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );
    return offer;
  }

  /**
   * The driver takes the offer. Offer, order, driver and the new assignment
   * move in one transaction; if any of them changed meanwhile nothing does.
   */
  async accept(
    user: AuthenticatedUser,
    offerId: string,
  ): Promise<OrderAssignment> {
    const driver = await this.driverOf(user);
    const offer = await this.prisma.driverOffer.findUnique({
      where: { id: offerId },
    });
    if (!offer || offer.driverId !== driver.id) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Offer not found',
      });
    }

    const assignment = await this.assignments.claimOrder(
      user,
      offer.orderId,
      offer.vehicleId,
      {
        viaOffer: true,
        beforeClaim: async (tx) => {
          const moved = await tx.driverOffer.updateMany({
            where: {
              id: offerId,
              driverId: driver.id,
              status: OFFER_STATUS.PENDING,
              expiresAt: { gt: new Date() },
            },
            data: {
              status: OFFER_STATUS.ACCEPTED,
              respondedAt: new Date(),
              actorUserId: user.id,
            },
          });
          if (moved.count !== 1) {
            throw new ConflictException({
              code: ERROR_CODES.RESOURCE_CONFLICT,
              message: 'Offer expired or was already answered',
            });
          }
        },
        afterClaim: async (tx, created) => {
          await tx.driverOffer.update({
            where: { id: offerId },
            data: { assignmentId: created.id },
          });
        },
      },
    );

    this.announce({ ...offer, status: OFFER_STATUS.ACCEPTED });
    return assignment;
  }

  async reject(
    user: AuthenticatedUser,
    offerId: string,
    reason?: string,
  ): Promise<DriverOffer> {
    const driver = await this.driverOf(user);
    const moved = await this.prisma.driverOffer.updateMany({
      where: { id: offerId, driverId: driver.id, status: OFFER_STATUS.PENDING },
      data: {
        status: OFFER_STATUS.REJECTED,
        respondedAt: new Date(),
        actorUserId: user.id,
        reason: reason?.trim() || null,
      },
    });
    if (moved.count !== 1) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Offer expired or was already answered',
      });
    }

    const offer = await this.prisma.driverOffer.findUniqueOrThrow({
      where: { id: offerId },
    });
    this.announce(offer);
    this.cascade(offer.orderId);
    return offer;
  }

  /** Expires one offer if it is still pending past its deadline. */
  async expire(offerId: string, now = new Date()): Promise<boolean> {
    const moved = await this.prisma.driverOffer.updateMany({
      where: {
        id: offerId,
        status: OFFER_STATUS.PENDING,
        expiresAt: { lte: now },
      },
      data: { status: OFFER_STATUS.EXPIRED, respondedAt: now },
    });
    if (moved.count !== 1) {
      return false;
    }
    const offer = await this.prisma.driverOffer.findUniqueOrThrow({
      where: { id: offerId },
    });
    this.announce(offer);
    this.cascade(offer.orderId);
    return true;
  }

  // ── Manual pick from the TMS ───────────────────────────────────────────────

  /**
   * An operator assigns a driver. Eligibility is re-validated against the
   * same ranking the TMS showed; choosing anyone but the top candidate needs
   * a reason, and the pick is kept as a MANUAL offer for the audit trail.
   */
  async manualAssign(
    user: AuthenticatedUser,
    orderId: string,
    input: ManualAssignInput,
  ): Promise<OrderAssignment> {
    const ranking = await this.rankingForManualPick(orderId);
    const candidate = ranking?.candidates.find(
      (row) => row.driverId === input.driverId,
    );
    const exclusion = ranking?.excluded.find(
      (row) => row.driverId === input.driverId,
    );
    // Without a usable ranking (no presence, pickup without coordinates) the
    // pick cannot be checked, only audited.
    const enforce =
      this.config.manualEnforce === 'on' &&
      ranking !== null &&
      !ranking.alerts.includes('PRESENCE_DISABLED');
    const reason = input.reason?.trim() || undefined;

    if (!candidate && enforce) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: exclusion
          ? `Driver is not eligible: ${exclusion.reason}`
          : 'Driver is not an eligible candidate near the pickup',
        details: exclusion ? { exclusion } : undefined,
      });
    }
    const top = ranking?.candidates[0];
    if (top && top.driverId !== input.driverId && !reason) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'A reason is required when not assigning the top candidate',
      });
    }

    const vehicleId = input.vehicleId ?? candidate?.vehicleId;
    if (!vehicleId) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'vehicleId is required for a driver outside the ranking',
      });
    }

    // An automatic offer still open for this order loses to the operator.
    await this.prisma.driverOffer.updateMany({
      where: { orderId, status: OFFER_STATUS.PENDING },
      data: {
        status: OFFER_STATUS.CANCELLED,
        respondedAt: new Date(),
        reason: 'Superseded by manual assignment',
      },
    });
    await this.setWaitingStatus(
      orderId,
      STATUS_ORDERS.ASSIGNING_DRIVER,
      STATUS_ORDERS.REQUESTED,
    );

    const assignment = await this.assignments.create(user, {
      orderId,
      driverId: input.driverId,
      vehicleId,
    });

    await this.prisma.driverOffer.create({
      data: {
        orderId,
        driverId: input.driverId,
        vehicleId,
        rank: candidate?.rank ?? 0,
        score: candidate?.score ?? null,
        etaSeconds: candidate?.etaSeconds ?? null,
        scoreVersion: ranking?.scoreVersion ?? this.config.scoreVersion,
        mode: OFFER_MODE.MANUAL,
        status: OFFER_STATUS.ACCEPTED,
        respondedAt: new Date(),
        actorUserId: user.id,
        reason: reason ?? null,
        assignmentId: assignment.id,
        snapshot: {
          ...(candidate && ranking
            ? snapshotOf(candidate, ranking.weights)
            : { outsideRanking: true, rankingAvailable: ranking !== null }),
          ...(exclusion && { exclusion: { ...exclusion } }),
          topCandidateId: top?.driverId ?? null,
        },
      },
    });

    return assignment;
  }

  // ── Payment hook ───────────────────────────────────────────────────────────

  /**
   * An order just became paid and dispatchable. Tells whoever watches it,
   * and in automatic mode offers it right away instead of waiting for the
   * next sweep. Called after the payment commits (see DispatchTriggerService),
   * so it re-reads the order rather than trusting the caller.
   */
  async onOrderDispatchable(orderId: string): Promise<void> {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: orderId },
      select: { status: true, paymentStatus: true },
    });
    if (
      !order ||
      order.status !== STATUS_ORDERS.REQUESTED ||
      !DISPATCHABLE_PAYMENT_STATUSES.includes(order.paymentStatus)
    ) {
      return;
    }

    this.realtime.emitOrderStatusChanged({
      orderId,
      status: order.status,
      changedAt: new Date().toISOString(),
    });
    if (this.autoEnabled) {
      this.realtime.emitMatchingStatus({
        orderId,
        state: 'SEARCHING',
        attempt: 0,
        at: new Date().toISOString(),
      });
      await this.offerNext(orderId);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Whether the order can take a new automatic offer: paid, still without a
   * driver, and no offer open. offerNext is reached from timers and events,
   * so it cannot assume the order is still where it was.
   */
  private async isWaitingForOffer(orderId: string): Promise<boolean> {
    const order = await this.prisma.transportOrder.findFirst({
      where: {
        id: orderId,
        status: { in: DISPATCH_WAITING_STATUSES },
        paymentStatus: { in: DISPATCHABLE_PAYMENT_STATUSES },
        orderAssignments: {
          none: {
            assignmentStatus: {
              in: [ASSIGNMENT_STATUS.PENDING, ASSIGNMENT_STATUS.ACCEPTED],
            },
          },
        },
        driverOffers: { none: { status: OFFER_STATUS.PENDING } },
      },
      select: { id: true },
    });
    return order !== null;
  }

  /** Compare-and-set between REQUESTED and ASSIGNING_DRIVER, announced. */
  private async setWaitingStatus(
    orderId: string,
    from: STATUS_ORDERS,
    to: STATUS_ORDERS,
  ): Promise<void> {
    const moved = await this.prisma.transportOrder.updateMany({
      where: { id: orderId, status: from },
      data: { status: to },
    });
    if (moved.count === 1) {
      this.realtime.emitOrderStatusChanged({
        orderId,
        status: to,
        previousStatus: from,
        changedAt: new Date().toISOString(),
      });
    }
  }

  private async rankingForManualPick(
    orderId: string,
  ): Promise<MatchingResult | null> {
    try {
      return await this.matching.rankForOrder(orderId);
    } catch (error) {
      // Order missing is the caller's 404; anything else must not block an
      // operator from dispatching by hand.
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.warn(
        `Manual pick for order ${orderId} without ranking: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  private async expireDue(now: Date): Promise<void> {
    const due = await this.prisma.driverOffer.findMany({
      where: { status: OFFER_STATUS.PENDING, expiresAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    for (const offer of due) {
      await this.expire(offer.id, now);
    }
  }

  /** Pending offers whose order was cancelled or assigned some other way. */
  private async cancelStale(): Promise<void> {
    const stale = await this.prisma.driverOffer.findMany({
      where: {
        status: OFFER_STATUS.PENDING,
        order: { status: { notIn: DISPATCH_WAITING_STATUSES } },
      },
      take: 100,
    });
    for (const offer of stale) {
      const moved = await this.prisma.driverOffer.updateMany({
        where: { id: offer.id, status: OFFER_STATUS.PENDING },
        data: {
          status: OFFER_STATUS.CANCELLED,
          respondedAt: new Date(),
          reason: 'Order is no longer waiting for a driver',
        },
      });
      if (moved.count === 1) {
        this.announce({ ...offer, status: OFFER_STATUS.CANCELLED });
      }
    }
  }

  /** Moves on to the next candidate without making the caller wait. */
  private cascade(orderId: string): void {
    void this.offerNext(orderId).catch((error: unknown) =>
      this.logger.error(
        `Cascade failed for order ${orderId}: ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );
  }

  private announce(offer: DriverOffer): void {
    this.realtime.emitOfferUpdated({
      offerId: offer.id,
      orderId: offer.orderId,
      driverId: offer.driverId,
      status: offer.status,
      mode: offer.mode,
      rank: offer.rank,
      etaSeconds: offer.etaSeconds,
      expiresAt: offer.expiresAt?.toISOString() ?? null,
    });
  }

  private async notifyDriver(offer: DriverOffer): Promise<void> {
    const [driver, order] = await Promise.all([
      this.prisma.driverProfile.findUnique({
        where: { id: offer.driverId },
        select: { userId: true },
      }),
      this.prisma.transportOrder.findUnique({
        where: { id: offer.orderId },
        select: { orderCode: true },
      }),
    ]);
    if (!driver) {
      return;
    }
    await this.notifications.dispatch(driver.userId, 'ORDER_OFFERED', {
      orderId: offer.orderId,
      orderCode: order?.orderCode,
      offerId: offer.id,
      expiresAt: offer.expiresAt?.toISOString(),
    });
  }

  private async driverOf(user: AuthenticatedUser) {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!driver) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Driver profile not found',
      });
    }
    return driver;
  }
}

/** The ranking row an offer was made from, frozen for later explanation. */
function snapshotOf(
  candidate: RankedCandidate,
  weights: object,
): Prisma.InputJsonObject {
  return {
    rank: candidate.rank,
    score: candidate.score,
    scoreBreakdown: { ...candidate.scoreBreakdown },
    weights: { ...weights },
    etaSeconds: candidate.etaSeconds,
    etaStatus: candidate.etaStatus,
    roadDistanceMeters: candidate.roadDistanceMeters,
    straightLineMeters: candidate.straightLineMeters,
    positionAgeSec: candidate.positionAgeSec,
    positionObservedAt: candidate.positionObservedAt,
    h3Cell: candidate.h3Cell,
    ring: candidate.ring,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
