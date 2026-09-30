import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  ASSIGNMENT_STATUS,
  OFFER_MODE,
  OFFER_STATUS,
  STATUS_DRIVER,
  STATUS_ORDERS,
  STATUS_VEHICLE,
  STOP_TYPE,
  VERIFICATION_STATUS,
  VERIFICATION_STATUS_DOCS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { h3CellOf, h3Ring, haversineMeters } from '@/common/utils/geo.util';
import { TtlCache } from '@/common/utils/ttl-cache.util';
import { matchingConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { GoogleRoutesError } from '@/integrations/google-maps/errors/google-routes.error';
import { GoogleRoutesService } from '@/integrations/google-maps/google-routes.service';
import type {
  LatLng,
  RouteMatrixResult,
} from '@/integrations/google-maps/interfaces/route.interface';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import {
  PresenceService,
  type PresenceRecord,
} from '../presence/presence.service';
import type {
  EtaStatus,
  ExcludedCandidate,
  ExclusionReason,
  MatchingResult,
  RankedCandidate,
  RankOptions,
} from './matching.types';
import {
  compareRanked,
  DEFAULT_WEIGHTS,
  normalizeWeights,
  scoreCandidate,
  type ScoreWeights,
} from './scoring';
import { RuntimeSettingsService } from '@/modules/administration/settings/runtime-settings.service';

/** SystemParameter key holding the JSON weights, e.g. {"eta":0.55,...}. */
export const WEIGHTS_PARAMETER_KEY = 'matching.score.weights';

const ACTIVE_ASSIGNMENT_STATUSES: ASSIGNMENT_STATUS[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
];
const ACTIVE_ORDER_STATUSES: STATUS_ORDERS[] = [
  STATUS_ORDERS.ASSIGNED,
  STATUS_ORDERS.ACCEPTED,
  STATUS_ORDERS.IN_PROGRESS,
];
/** Vehicle documents whose expiry or rejection blocks a dispatch. */
const REQUIRED_VEHICLE_DOCUMENTS = new Set(['REGISTRATION', 'INSURANCE']);
const RELIABILITY_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** Dominican Republic is UTC-4 all year (no DST). */
const DR_UTC_OFFSET_MS = -4 * 60 * 60_000;

/** A driver that passed every filter, before the ETA is known. */
interface EligibleDriver {
  driverId: string;
  driverName: string | null;
  vehicleId: string;
  plateNumber: string | null;
  vehicleCategoryId: string;
  rating: number;
  presence: PresenceRecord;
  ring: number;
  straightLineMeters: number;
}

/**
 * Ranks drivers for an order: H3 rings around the pickup → mandatory filters
 * → Route Matrix ETA for the closest few → weighted score.
 *
 * The same ranking feeds the TMS recommendation and the automatic offer
 * cascade, so both always use one rule version (spec §6). It reads state and
 * never writes: offering and assigning belong to the dispatch services.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);
  private readonly matrixCache = new TtlCache<RouteMatrixResult>(30_000, 200);
  private weightsCache: { value: ScoreWeights; expiresAt: number } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly routes: GoogleRoutesService,
    private readonly realtime: RealtimeService,
    @Inject(matchingConfig.KEY)
    private readonly config: ConfigType<typeof matchingConfig>,
    @Optional() private readonly settings?: RuntimeSettingsService,
  ) {}

  async rankForOrder(
    orderId: string,
    options: RankOptions = {},
  ): Promise<MatchingResult> {
    const now = new Date();
    const order = await this.loadOrder(orderId);
    const pickupCell = h3CellOf(order.pickup, this.config.h3Resolution);
    const weights = await this.weights();

    const result: MatchingResult = {
      orderId,
      pickup: { ...order.pickup, h3Cell: pickupCell },
      h3Resolution: this.config.h3Resolution,
      ringsSearched: 0,
      scoreVersion: this.config.scoreVersion,
      weights,
      etaProvider: null,
      computedAt: now.toISOString(),
      candidates: [],
      excluded: [],
      alerts: [],
    };

    if (!this.presence.isEnabled) {
      result.alerts.push('PRESENCE_DISABLED');
      return this.finish(result, options);
    }

    const skip = new Set(options.excludeDriverIds ?? []);
    const seen = new Set<string>();
    const eligible: EligibleDriver[] = [];

    // Grow the search one ring at a time and stop as soon as there are enough
    // eligible drivers: the Matrix call is billed per origin.
    const maxRings =
      this.settings?.get('matching.max_rings') ?? this.config.maxRings;
    for (let ring = 0; ring <= maxRings; ring += 1) {
      result.ringsSearched = ring;
      const members = await this.presence.membersOfCells(
        h3Ring(pickupCell, ring),
        now,
      );
      const fresh = members.fresh.filter((id) => !seen.has(id));
      const stale = members.stale.filter((id) => !seen.has(id));
      fresh.forEach((id) => seen.add(id));
      stale.forEach((id) => seen.add(id));

      for (const id of fresh.filter((id) => skip.has(id))) {
        result.excluded.push(exclusion(id, 'ALREADY_OFFERED', ring, null));
      }

      const found = await this.filterEligible(
        fresh.filter((id) => !skip.has(id)),
        order.vehicleCategoryId,
        order.pickup,
        ring,
        now,
        result.excluded,
      );
      eligible.push(...found);
      await this.reportStale(stale, ring, now, result.excluded);

      if (eligible.length >= this.config.minCandidates) {
        break;
      }
    }

    // Pre-select by straight line; only these go to the (billed) matrix.
    eligible.sort((a, b) => a.straightLineMeters - b.straightLineMeters);
    const preselected = eligible.slice(0, this.config.maxMatrixOrigins);
    for (const driver of eligible.slice(this.config.maxMatrixOrigins)) {
      result.excluded.push({
        ...exclusion(driver.driverId, 'OUTSIDE_PRESELECTION', driver.ring, 0),
        driverName: driver.driverName,
        positionAgeSec: ageSec(driver.presence, now),
      });
    }

    if (preselected.length === 0) {
      return this.finish(result, options);
    }

    const matrix = await this.matrixFor(orderId, preselected, order.pickup);
    result.etaProvider = matrix?.provider ?? null;
    if (!matrix) {
      result.alerts.push('ROUTES_PROVIDER_FAILED');
    }

    const stats = await this.driverStats(
      preselected.map((driver) => driver.driverId),
      now,
    );

    const ranked: RankedCandidate[] = [];
    preselected.forEach((driver, index) => {
      const element = matrix?.elements.find(
        (candidate) =>
          candidate.originIndex === index && candidate.destinationIndex === 0,
      );
      const etaStatus: EtaStatus = !matrix
        ? 'FAILED'
        : element?.status === 'OK'
          ? 'OK'
          : element?.status === 'ROUTE_NOT_FOUND'
            ? 'NO_ROUTE'
            : 'FAILED';

      // No road to the pickup is a hard exclusion, not a low score.
      if (etaStatus === 'NO_ROUTE') {
        result.excluded.push({
          ...exclusion(driver.driverId, 'NO_ROUTE_TO_PICKUP', driver.ring, 0),
          driverName: driver.driverName,
          positionAgeSec: ageSec(driver.presence, now),
        });
        return;
      }

      const etaSeconds = etaStatus === 'OK' ? element!.durationSeconds : null;
      const roadDistanceMeters =
        etaStatus === 'OK' ? element!.distanceMeters : null;
      const stat = stats.get(driver.driverId);
      const { score, breakdown } = scoreCandidate(
        {
          etaSeconds,
          roadDistanceMeters,
          straightLineMeters: driver.straightLineMeters,
          rating: driver.rating,
          acceptanceRate: stat?.acceptanceRate ?? null,
          tripsToday: stat?.tripsToday ?? 0,
        },
        weights,
      );

      ranked.push({
        rank: 0,
        driverId: driver.driverId,
        driverName: driver.driverName,
        vehicleId: driver.vehicleId,
        plateNumber: driver.plateNumber,
        vehicleCategoryId: driver.vehicleCategoryId,
        etaSeconds,
        etaStatus,
        roadDistanceMeters,
        straightLineMeters: Math.round(driver.straightLineMeters),
        positionAgeSec: ageSec(driver.presence, now),
        positionObservedAt: driver.presence.observedAt.toISOString(),
        accuracyM: driver.presence.accuracyM,
        h3Cell: driver.presence.h3Cell,
        ring: driver.ring,
        score,
        scoreBreakdown: breakdown,
        rating: driver.rating,
        acceptanceRate: stat?.acceptanceRate ?? null,
        tripsToday: stat?.tripsToday ?? 0,
      });
    });

    ranked.sort(compareRanked);
    ranked.forEach((candidate, index) => {
      candidate.rank = index + 1;
    });
    result.candidates = ranked;

    return this.finish(result, options);
  }

  /** Current weights: SystemParameter override, else the spec defaults. */
  async weights(): Promise<ScoreWeights> {
    // Configuración edits land here within seconds, no cache to wait out.
    if (this.settings) {
      return normalizeWeights(this.settings.get('matching.score.weights'));
    }
    if (this.weightsCache && this.weightsCache.expiresAt > Date.now()) {
      return this.weightsCache.value;
    }
    let value = DEFAULT_WEIGHTS;
    try {
      const parameter = await this.prisma.systemParameter.findUnique({
        where: { key: WEIGHTS_PARAMETER_KEY },
        select: { value: true },
      });
      if (parameter) {
        value = normalizeWeights(
          JSON.parse(parameter.value) as Partial<ScoreWeights>,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Invalid ${WEIGHTS_PARAMETER_KEY}, using defaults: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
    this.weightsCache = { value, expiresAt: Date.now() + 60_000 };
    return value;
  }

  private finish(result: MatchingResult, options: RankOptions): MatchingResult {
    if (result.candidates.length === 0) {
      result.alerts.push('NO_CANDIDATES');
    }
    if (options.emitAlerts && result.alerts.length > 0) {
      this.emitAlert(result.orderId, result.alerts);
    }
    return result;
  }

  /** Tells operations an order needs a human (no drivers, provider down...). */
  emitAlert(orderId: string, alerts: string[]): void {
    this.realtime.emitTripEvent(orderId, 'matching.alert', {
      orderId,
      alerts,
      raisedAt: new Date().toISOString(),
    });
  }

  private async loadOrder(orderId: string) {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        vehicleCategoryId: true,
        orderStops: {
          where: { stopType: STOP_TYPE.PICKUP },
          orderBy: { sequence: 'asc' },
          take: 1,
          select: { latitude: true, longitude: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    const stop = order.orderStops[0];
    if (!stop || stop.latitude === null || stop.longitude === null) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Order pickup has no coordinates to match drivers against',
      });
    }

    return {
      vehicleCategoryId: order.vehicleCategoryId,
      pickup: {
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
      },
    };
  }

  /** Mandatory filters (spec §2.1 "Elegibilidad"), one query batch per ring. */
  private async filterEligible(
    driverIds: string[],
    vehicleCategoryId: string,
    pickup: LatLng,
    ring: number,
    now: Date,
    excluded: ExcludedCandidate[],
  ): Promise<EligibleDriver[]> {
    if (driverIds.length === 0) {
      return [];
    }

    const [drivers, vehicles, activeTrips, pendingOffers, presences] =
      await Promise.all([
        this.prisma.driverProfile.findMany({
          where: { id: { in: driverIds } },
          select: {
            id: true,
            availabilityStatus: true,
            verificationStatus: true,
            licenseExpiration: true,
            ratingAVG: true,
            user: { select: { fullName: true } },
          },
        }),
        this.prisma.vehicle.findMany({
          where: {
            driverId: { in: driverIds },
            status: STATUS_VEHICLE.ACTIVE,
            categoryId: vehicleCategoryId,
          },
          select: {
            id: true,
            driverId: true,
            plateNumber: true,
            categoryId: true,
            vehiclesDocuments: {
              select: {
                documentType: true,
                status: true,
                expirationDate: true,
              },
            },
          },
        }),
        this.prisma.orderAssignment.findMany({
          where: {
            driverId: { in: driverIds },
            assignmentStatus: { in: ACTIVE_ASSIGNMENT_STATUSES },
            order: { status: { in: ACTIVE_ORDER_STATUSES } },
          },
          select: { driverId: true },
        }),
        this.prisma.driverOffer.findMany({
          where: {
            driverId: { in: driverIds },
            status: OFFER_STATUS.PENDING,
            expiresAt: { gt: now },
          },
          select: { driverId: true },
        }),
        this.presence.getMany(driverIds),
      ]);

    const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
    const presenceById = new Map(
      presences.map((presence) => [presence.driverId, presence]),
    );
    const busy = new Set(activeTrips.map((trip) => trip.driverId));
    const offered = new Set(pendingOffers.map((offer) => offer.driverId));
    const eligible: EligibleDriver[] = [];

    for (const driverId of driverIds) {
      const driver = driverById.get(driverId);
      const presence = presenceById.get(driverId);
      const name = driver?.user?.fullName ?? null;
      const age = presence ? ageSec(presence, now) : null;
      const exclude = (reason: ExclusionReason, detail?: string) =>
        excluded.push({
          driverId,
          driverName: name,
          reason,
          ring,
          positionAgeSec: age,
          ...(detail && { detail }),
        });

      if (!driver) {
        exclude('DRIVER_NOT_FOUND');
        continue;
      }
      if (driver.verificationStatus !== VERIFICATION_STATUS.APPROVED) {
        exclude('NOT_APPROVED');
        continue;
      }
      if (driver.availabilityStatus !== STATUS_DRIVER.AVAILABLE) {
        exclude('NOT_AVAILABLE', driver.availabilityStatus);
        continue;
      }
      if (driver.licenseExpiration.getTime() <= now.getTime()) {
        exclude('LICENSE_EXPIRED');
        continue;
      }
      if (busy.has(driverId)) {
        exclude('ACTIVE_TRIP');
        continue;
      }
      if (offered.has(driverId)) {
        exclude('OFFER_PENDING_ELSEWHERE');
        continue;
      }
      if (!presence || !this.presence.isFresh(presence, now)) {
        exclude('POSITION_STALE');
        continue;
      }

      const own = vehicles.filter((vehicle) => vehicle.driverId === driverId);
      if (own.length === 0) {
        exclude('NO_ACTIVE_VEHICLE_IN_CATEGORY');
        continue;
      }
      const valid = own.filter((vehicle) =>
        vehicle.vehiclesDocuments.every(
          (document) =>
            !REQUIRED_VEHICLE_DOCUMENTS.has(document.documentType) ||
            (document.status !== VERIFICATION_STATUS_DOCS.REJECTED &&
              document.expirationDate.getTime() > now.getTime()),
        ),
      );
      if (valid.length === 0) {
        exclude('VEHICLE_DOCUMENTS_INVALID');
        continue;
      }
      // Prefer the vehicle the app says it is driving.
      const vehicle =
        valid.find((candidate) => candidate.id === presence.vehicleId) ??
        valid[0];

      eligible.push({
        driverId,
        driverName: name,
        vehicleId: vehicle.id,
        plateNumber: vehicle.plateNumber,
        vehicleCategoryId: vehicle.categoryId,
        rating: Number(driver.ratingAVG ?? 0),
        presence,
        ring,
        straightLineMeters: haversineMeters(presence, pickup),
      });
    }

    return eligible;
  }

  /** Stale positions are not ranked, but the TMS must be told why. */
  private async reportStale(
    driverIds: string[],
    ring: number,
    now: Date,
    excluded: ExcludedCandidate[],
  ): Promise<void> {
    if (driverIds.length === 0) {
      return;
    }
    const [presences, drivers] = await Promise.all([
      this.presence.getMany(driverIds),
      this.prisma.driverProfile.findMany({
        where: { id: { in: driverIds } },
        select: { id: true, user: { select: { fullName: true } } },
      }),
    ]);
    const names = new Map(drivers.map((d) => [d.id, d.user?.fullName ?? null]));
    const presenceById = new Map(presences.map((p) => [p.driverId, p]));

    for (const driverId of driverIds) {
      const presence = presenceById.get(driverId);
      const lowAccuracy =
        presence?.lastRejection === 'LOW_ACCURACY' ||
        presence?.lastRejection === 'MISSING_ACCURACY';
      excluded.push({
        driverId,
        driverName: names.get(driverId) ?? null,
        reason: lowAccuracy ? 'POSITION_LOW_ACCURACY' : 'POSITION_STALE',
        ring,
        positionAgeSec: presence ? ageSec(presence, now) : null,
        ...(presence?.lastRejection && { detail: presence.lastRejection }),
      });
    }
  }

  /** One Matrix call for all origins; null when the provider failed. */
  private async matrixFor(
    orderId: string,
    drivers: EligibleDriver[],
    pickup: LatLng,
  ): Promise<RouteMatrixResult | null> {
    const origins = drivers.map((driver) => ({
      latitude: driver.presence.latitude,
      longitude: driver.presence.longitude,
    }));
    // ~110 m rounding: a TMS refresh a few seconds later reuses the answer.
    const key = [
      orderId,
      ...origins.map(
        (o) => `${o.latitude.toFixed(3)},${o.longitude.toFixed(3)}`,
      ),
    ].join('|');
    const cached = this.matrixCache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const matrix = await this.routes.computeRouteMatrix(origins, [pickup]);
      this.matrixCache.set(key, matrix);
      return matrix;
    } catch (error) {
      this.logger.error(
        `Route matrix failed for order ${orderId}: ${error instanceof Error ? error.message : 'unknown'}${error instanceof GoogleRoutesError ? ` (${error.reason})` : ''}`,
      );
      return null;
    }
  }

  /** Acceptance rate over 30 days and trips started today (DR time). */
  private async driverStats(
    driverIds: string[],
    now: Date,
  ): Promise<
    Map<string, { acceptanceRate: number | null; tripsToday: number }>
  > {
    const [offers, trips] = await Promise.all([
      this.prisma.driverOffer.groupBy({
        by: ['driverId', 'status'],
        where: {
          driverId: { in: driverIds },
          // Manual picks say nothing about whether the driver answers offers.
          mode: OFFER_MODE.AUTO,
          createdAt: { gte: new Date(now.getTime() - RELIABILITY_WINDOW_MS) },
          status: {
            in: [
              OFFER_STATUS.ACCEPTED,
              OFFER_STATUS.REJECTED,
              OFFER_STATUS.EXPIRED,
            ],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.orderAssignment.groupBy({
        by: ['driverId'],
        where: {
          driverId: { in: driverIds },
          assignedAt: { gte: startOfDrDay(now) },
          assignmentStatus: {
            in: [ASSIGNMENT_STATUS.ACCEPTED, ASSIGNMENT_STATUS.COMPLETED],
          },
        },
        _count: { _all: true },
      }),
    ]);

    const stats = new Map<
      string,
      { acceptanceRate: number | null; tripsToday: number }
    >();
    for (const driverId of driverIds) {
      const mine = offers.filter((row) => row.driverId === driverId);
      const answered = mine.reduce((sum, row) => sum + row._count._all, 0);
      const accepted =
        mine.find((row) => row.status === OFFER_STATUS.ACCEPTED)?._count._all ??
        0;
      stats.set(driverId, {
        acceptanceRate: answered > 0 ? accepted / answered : null,
        tripsToday:
          trips.find((row) => row.driverId === driverId)?._count._all ?? 0,
      });
    }
    return stats;
  }
}

function exclusion(
  driverId: string,
  reason: ExclusionReason,
  ring: number | null,
  positionAgeSec: number | null,
): ExcludedCandidate {
  return { driverId, driverName: null, reason, ring, positionAgeSec };
}

function ageSec(presence: PresenceRecord, now: Date): number {
  return Math.max(
    0,
    Math.round((now.getTime() - presence.observedAt.getTime()) / 1000),
  );
}

function startOfDrDay(now: Date): Date {
  const local = new Date(now.getTime() + DR_UTC_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - DR_UTC_OFFSET_MS);
}
