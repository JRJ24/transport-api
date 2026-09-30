import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { cellToChildren } from 'h3-js';
import {
  PAYMENT_STATUS,
  STATUS_ORDERS,
  STATUS_VEHICLE,
  STOP_TYPE,
} from '@generated/prisma/enums';
import { h3CellOf } from '@/common/utils/geo.util';
import { demandConfig, matchingConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { RedisService } from '@/database/redis.service';
import type { LatLng } from '@/integrations/google-maps/interfaces/route.interface';
import { PresenceService } from '@/modules/operations/presence/presence.service';
import {
  type DemandBand,
  DEFAULT_DEMAND_BANDS,
  normalizeBands,
  resolveBandIndex,
  smoothRatio,
} from './demand-bands';
import { RuntimeSettingsService } from '@/modules/administration/settings/runtime-settings.service';

/** SystemParameter key for JSON bands, e.g. [{"above":1,"multiplier":1.1,"label":"MODERADO"}]. */
export const DEMAND_BANDS_PARAMETER_KEY = 'pricing.demand.bands';

/** How often the smoothed ratio of one cell and category may move. */
const STATE_TICK_MS = 60_000;

/** Orders still waiting for a driver count as active requests. */
const WAITING_STATUSES: STATUS_ORDERS[] = [
  STATUS_ORDERS.REQUESTED,
  STATUS_ORDERS.ASSIGNING_DRIVER,
];

/** What demand did to one quote. Stored in the quote breakdown as-is. */
export interface DemandSnapshot {
  mode: 'off' | 'shadow' | 'on';
  h3Cell: string;
  h3Resolution: number;
  vehicleCategoryId: string;
  windowSec: number;
  activeRequests: number;
  availableDrivers: number;
  /** requests / max(1, drivers), before smoothing. */
  rawRatio: number;
  smoothedRatio: number;
  band: string;
  /** What the rules say. */
  computedMultiplier: number;
  /** What is charged: 1 in shadow mode. */
  appliedMultiplier: number;
  /** Fewer requests than the observation floor: multiplier forced to 1. */
  belowMinObservations: boolean;
  /** Nobody available: the quote cannot promise a driver. */
  noSupply: boolean;
  computedAt: string;
}

interface SmoothedState {
  ratio: number;
  bandIndex: number;
  at: number;
}

/**
 * Supply/demand multiplier per H3 area and vehicle category.
 *
 * Demand is read from Postgres (orders waiting for a driver in the window,
 * bucketed by the H3 cell of their pickup) and supply from Redis presence,
 * restricted to drivers with an active vehicle of the category. The smoothed
 * ratio and band live in Redis so every API instance quotes the same way.
 */
@Injectable()
export class DemandService {
  private readonly logger = new Logger(DemandService.name);
  private bandsCache: { value: DemandBand[]; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly presence: PresenceService,
    @Inject(demandConfig.KEY)
    private readonly config: ConfigType<typeof demandConfig>,
    @Inject(matchingConfig.KEY)
    private readonly matching: ConfigType<typeof matchingConfig>,
    @Optional() private readonly settings?: RuntimeSettingsService,
  ) {}

  /** Editable from Configuración; the env value is the default. */
  get mode(): 'off' | 'shadow' | 'on' {
    return this.settings?.get('pricing.demand.mode') ?? this.config.mode;
  }

  /**
   * Demand for several categories at one pickup, in one pass. Returns an
   * empty map when demand pricing is off or Redis is unavailable: the caller
   * then prices at 1.00 without a snapshot.
   */
  async forPickup(
    pickup: LatLng,
    vehicleCategoryIds: string[],
    now = new Date(),
  ): Promise<Map<string, DemandSnapshot>> {
    const result = new Map<string, DemandSnapshot>();
    if (
      this.mode === 'off' ||
      !this.redis.client ||
      vehicleCategoryIds.length === 0
    ) {
      return result;
    }

    try {
      const cell = h3CellOf(pickup, this.config.h3Resolution);
      const [requests, supply, bands] = await Promise.all([
        this.activeRequests(cell, vehicleCategoryIds, now),
        this.availableDrivers(cell, vehicleCategoryIds, now),
        this.bands(),
      ]);

      for (const categoryId of vehicleCategoryIds) {
        result.set(
          categoryId,
          await this.snapshot(
            cell,
            categoryId,
            requests.get(categoryId) ?? 0,
            supply.get(categoryId) ?? 0,
            bands,
            now,
          ),
        );
      }
    } catch (error) {
      // Demand is an adjustment, never a reason to fail a quote.
      this.logger.error(
        `Demand lookup failed, pricing at 1.00: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      result.clear();
    }
    return result;
  }

  private async snapshot(
    cell: string,
    categoryId: string,
    activeRequests: number,
    availableDrivers: number,
    bands: DemandBand[],
    now: Date,
  ): Promise<DemandSnapshot> {
    const rawRatio = activeRequests / Math.max(1, availableDrivers);
    const belowMinObservations = activeRequests < this.config.minObservations;
    const key = `demand:state:${cell}:${categoryId}`;
    const previous = await this.readState(key, now);

    // The smoothed state advances once per tick, not once per quote: the
    // category cards re-quote on every typing pause, and letting each call
    // step the EMA would erase the smoothing within seconds.
    const fresh =
      previous !== null && now.getTime() - previous.at < STATE_TICK_MS;
    let smoothedRatio: number;
    let bandIndex: number;
    if (fresh) {
      smoothedRatio = previous.ratio;
      bandIndex = Math.min(previous.bandIndex, bands.length - 1);
    } else {
      smoothedRatio = smoothRatio(
        belowMinObservations ? 0 : rawRatio,
        previous?.ratio ?? null,
        this.config.smoothing,
      );
      bandIndex = belowMinObservations
        ? 0
        : resolveBandIndex(
            smoothedRatio,
            previous?.bandIndex ?? null,
            bands,
            this.config.hysteresis,
          );
      await this.redis.client!.set(
        key,
        JSON.stringify({ ratio: smoothedRatio, bandIndex, at: now.getTime() }),
        'EX',
        this.config.windowSec * 2,
      );
    }

    const band = bands[bandIndex] ?? DEFAULT_DEMAND_BANDS[0];
    const computedMultiplier = Math.min(
      band.multiplier,
      this.config.maxMultiplier,
    );

    return {
      mode: this.mode,
      h3Cell: cell,
      h3Resolution: this.config.h3Resolution,
      vehicleCategoryId: categoryId,
      windowSec: this.config.windowSec,
      activeRequests,
      availableDrivers,
      rawRatio: round3(rawRatio),
      smoothedRatio: round3(smoothedRatio),
      band: band.label,
      computedMultiplier,
      appliedMultiplier: this.mode === 'on' ? computedMultiplier : 1,
      belowMinObservations,
      noSupply: availableDrivers === 0,
      computedAt: now.toISOString(),
    };
  }

  private async readState(
    key: string,
    now: Date,
  ): Promise<SmoothedState | null> {
    const raw = await this.redis.client!.get(key);
    if (!raw) {
      return null;
    }
    try {
      const state = JSON.parse(raw) as SmoothedState;
      // Too old to smooth against: start over.
      return now.getTime() - state.at > this.config.windowSec * 2000
        ? null
        : state;
    } catch {
      return null;
    }
  }

  /** Orders waiting for a driver, created in the window, per category. */
  private async activeRequests(
    cell: string,
    vehicleCategoryIds: string[],
    now: Date,
  ): Promise<Map<string, number>> {
    const orders = await this.prisma.transportOrder.findMany({
      where: {
        status: { in: WAITING_STATUSES },
        paymentStatus: {
          in: [
            PAYMENT_STATUS.PAID,
            PAYMENT_STATUS.AUTHORIZED,
            PAYMENT_STATUS.PENDING,
            PAYMENT_STATUS.PROCESSING,
          ],
        },
        vehicleCategoryId: { in: vehicleCategoryIds },
        createdAt: {
          gte: new Date(now.getTime() - this.config.windowSec * 1000),
        },
      },
      select: {
        vehicleCategoryId: true,
        orderStops: {
          where: { stopType: STOP_TYPE.PICKUP },
          orderBy: { sequence: 'asc' },
          take: 1,
          select: { latitude: true, longitude: true },
        },
      },
      take: 2000,
    });

    const counts = new Map<string, number>();
    for (const order of orders) {
      const stop = order.orderStops[0];
      if (!stop || stop.latitude === null || stop.longitude === null) {
        continue;
      }
      const orderCell = h3CellOf(
        { latitude: Number(stop.latitude), longitude: Number(stop.longitude) },
        this.config.h3Resolution,
      );
      if (orderCell === cell) {
        counts.set(
          order.vehicleCategoryId,
          (counts.get(order.vehicleCategoryId) ?? 0) + 1,
        );
      }
    }
    return counts;
  }

  /** Fresh presence inside the demand cell, by category of active vehicle. */
  private async availableDrivers(
    cell: string,
    vehicleCategoryIds: string[],
    now: Date,
  ): Promise<Map<string, number>> {
    const presenceCells =
      this.matching.h3Resolution > this.config.h3Resolution
        ? cellToChildren(cell, this.matching.h3Resolution)
        : [cell];
    const { fresh } = await this.presence.membersOfCells(presenceCells, now);
    const counts = new Map<string, number>();
    if (fresh.length === 0) {
      return counts;
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        driverId: { in: fresh },
        status: STATUS_VEHICLE.ACTIVE,
        categoryId: { in: vehicleCategoryIds },
      },
      select: { driverId: true, categoryId: true },
    });
    const driversByCategory = new Map<string, Set<string>>();
    for (const vehicle of vehicles) {
      const set = driversByCategory.get(vehicle.categoryId) ?? new Set();
      set.add(vehicle.driverId);
      driversByCategory.set(vehicle.categoryId, set);
    }
    for (const [categoryId, drivers] of driversByCategory) {
      counts.set(categoryId, drivers.size);
    }
    return counts;
  }

  private async bands(): Promise<DemandBand[]> {
    if (this.settings) {
      return normalizeBands(this.settings.get('pricing.demand.bands'));
    }
    if (this.bandsCache && this.bandsCache.expiresAt > Date.now()) {
      return this.bandsCache.value;
    }
    let value = DEFAULT_DEMAND_BANDS;
    try {
      const parameter = await this.prisma.systemParameter.findUnique({
        where: { key: DEMAND_BANDS_PARAMETER_KEY },
        select: { value: true },
      });
      if (parameter) {
        value = normalizeBands(JSON.parse(parameter.value) as DemandBand[]);
      }
    } catch (error) {
      this.logger.warn(
        `Invalid ${DEMAND_BANDS_PARAMETER_KEY}, using defaults: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
    this.bandsCache = { value, expiresAt: Date.now() + 60_000 };
    return value;
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
