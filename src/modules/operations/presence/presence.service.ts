import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';
import {
  h3CellOf,
  haversineMeters,
  isInServiceArea,
} from '@/common/utils/geo.util';
import { TtlCache } from '@/common/utils/ttl-cache.util';
import { matchingConfig, trackingConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { RedisService } from '@/database/redis.service';

/** What a driver app reports while it is available for work. */
export interface PresenceInput {
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  heading?: number | null;
  speed?: number | null;
  vehicleId?: string | null;
  isMocked?: boolean;
  /** When the fix was taken on the device. Defaults to reception time. */
  observedAt?: string | Date;
}

/** A driver's latest accepted position, as stored in Redis. */
export interface PresenceRecord {
  driverId: string;
  vehicleId: string | null;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  heading: number | null;
  speed: number | null;
  observedAt: Date;
  receivedAt: Date;
  status: STATUS_DRIVER;
  h3Cell: string;
  /** Why the most recent fix after this one was refused, if it was. */
  lastRejection: PresenceRejection | null;
  lastRejectedAt: Date | null;
}

/** Fresh drivers can be ranked; stale ones are only reported as excluded. */
export interface CellMembers {
  fresh: string[];
  stale: string[];
}

export type PresenceRejection =
  | 'REDIS_DISABLED'
  | 'DRIVER_NOT_FOUND'
  | 'DRIVER_NOT_AVAILABLE'
  | 'DRIVER_NOT_APPROVED'
  | 'INVALID_COORDINATES'
  | 'OUT_OF_SERVICE_AREA'
  | 'MOCKED_LOCATION'
  | 'MISSING_ACCURACY'
  | 'LOW_ACCURACY'
  | 'FUTURE_TIMESTAMP'
  | 'STALE_TIMESTAMP'
  | 'OUT_OF_ORDER'
  | 'IMPOSSIBLE_JUMP'
  | 'THROTTLED';

export type PresenceResult =
  | { accepted: true; h3Cell: string; expiresAt: string }
  | { accepted: false; reason: PresenceRejection };

interface DriverGate {
  id: string;
  availabilityStatus: STATUS_DRIVER;
  verificationStatus: VERIFICATION_STATUS;
}

/** Device clocks drift; a fix this far in the future is still believable. */
const MAX_CLOCK_SKEW_MS = 30_000;

/**
 * A position stays stored this many TTLs after it stops being fresh, so the
 * TMS can say "position is 4 min old" instead of the driver silently vanishing.
 */
const RETENTION_TTL_MULTIPLIER = 10;

/** Refused fixes worth remembering on the driver's record for the TMS. */
const NOTED_REJECTIONS = new Set<PresenceRejection>([
  'LOW_ACCURACY',
  'MISSING_ACCURACY',
  'MOCKED_LOCATION',
  'OUT_OF_SERVICE_AREA',
  'IMPOSSIBLE_JUMP',
]);

const driverKey = (driverId: string) => `presence:driver:${driverId}`;
const cellKey = (cell: string) => `presence:cell:${cell}`;

/**
 * Hot state of where available drivers are, indexed by H3 cell.
 *
 * Presence is a *hint* for candidate search, never the source of truth: the
 * database still decides whether a driver is available, approved and fit for
 * an order, and matching re-checks all of that. That is why a driver's status
 * is cached here for a few seconds instead of read on every GPS ping.
 *
 * Layout:
 * - `presence:driver:{id}` hash with the latest fix, expiring after the TTL.
 * - `presence:cell:{h3}` sorted set of driver ids scored by observedAt, so a
 *   cell read can drop stale members by score without touching each hash.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly gateByUser = new TtlCache<DriverGate | null>(15_000, 5000);
  /** Reverse index so `remove(driverId)` can also drop the cached gate. */
  private readonly userByDriver = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(matchingConfig.KEY)
    private readonly config: ConfigType<typeof matchingConfig>,
    @Inject(trackingConfig.KEY)
    private readonly tracking: ConfigType<typeof trackingConfig>,
  ) {}

  get isEnabled(): boolean {
    return this.redis.isEnabled;
  }

  /** Records presence for the driver profile behind an authenticated user. */
  async recordForUser(
    userId: string,
    input: PresenceInput,
  ): Promise<PresenceResult> {
    const gate = await this.driverGate(userId);
    if (!gate) {
      return { accepted: false, reason: 'DRIVER_NOT_FOUND' };
    }
    if (gate.verificationStatus !== VERIFICATION_STATUS.APPROVED) {
      return { accepted: false, reason: 'DRIVER_NOT_APPROVED' };
    }
    if (gate.availabilityStatus !== STATUS_DRIVER.AVAILABLE) {
      // Not an error: the app may keep pinging for a moment after going busy.
      await this.remove(gate.id);
      return { accepted: false, reason: 'DRIVER_NOT_AVAILABLE' };
    }

    return this.record(gate.id, gate.availabilityStatus, input);
  }

  /** Validates and stores one fix. Exposed for tests and trusted callers. */
  async record(
    driverId: string,
    status: STATUS_DRIVER,
    input: PresenceInput,
    now = new Date(),
  ): Promise<PresenceResult> {
    const redis = this.redis.client;
    if (!redis) {
      return { accepted: false, reason: 'REDIS_DISABLED' };
    }

    const previous = await this.get(driverId);
    const rejection = this.validate(input, now);
    if (rejection) {
      await this.noteRejection(previous, rejection, now);
      return { accepted: false, reason: rejection };
    }

    const observedAt = input.observedAt ? new Date(input.observedAt) : now;

    if (previous) {
      if (
        now.getTime() - previous.receivedAt.getTime() <
        this.config.presenceMinIntervalMs
      ) {
        return { accepted: false, reason: 'THROTTLED' };
      }
      if (observedAt.getTime() <= previous.observedAt.getTime()) {
        return { accepted: false, reason: 'OUT_OF_ORDER' };
      }
      const seconds =
        (observedAt.getTime() - previous.observedAt.getTime()) / 1000;
      const meters = haversineMeters(previous, input);
      if (meters / seconds > this.tracking.maxSpeedMps) {
        this.logger.warn(
          `Presence jump rejected for driver ${driverId}: ${(meters / seconds).toFixed(1)} m/s`,
        );
        await this.noteRejection(previous, 'IMPOSSIBLE_JUMP', now);
        return { accepted: false, reason: 'IMPOSSIBLE_JUMP' };
      }
    }

    const h3Cell = h3CellOf(input, this.config.h3Resolution);
    const ttl = this.config.presenceTtlSec;
    const retention = this.retentionSec;
    const record: Record<string, string> = {
      driverId,
      vehicleId: input.vehicleId ?? '',
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      accuracyM: input.accuracyM == null ? '' : String(input.accuracyM),
      heading: input.heading == null ? '' : String(input.heading),
      speed: input.speed == null ? '' : String(input.speed),
      observedAt: observedAt.toISOString(),
      receivedAt: now.toISOString(),
      status,
      h3Cell,
      lastRejection: '',
      lastRejectedAt: '',
    };

    const tx = redis.multi();
    if (previous && previous.h3Cell !== h3Cell) {
      tx.zrem(cellKey(previous.h3Cell), driverId);
    }
    tx.hset(driverKey(driverId), record);
    tx.expire(driverKey(driverId), retention);
    tx.zadd(cellKey(h3Cell), observedAt.getTime(), driverId);
    // Cells nobody reports from any more clean themselves up.
    tx.expire(cellKey(h3Cell), retention);
    await tx.exec();

    return {
      accepted: true,
      h3Cell,
      expiresAt: new Date(observedAt.getTime() + ttl * 1000).toISOString(),
    };
  }

  /**
   * Drops a driver from presence (went offline, busy, suspended...). Also
   * forgets the cached status so the next ping re-reads the database instead
   * of re-adding a driver that just became busy.
   */
  async remove(driverId: string): Promise<void> {
    const userId = this.userByDriver.get(driverId);
    if (userId) {
      this.gateByUser.delete(userId);
    }
    const redis = this.redis.client;
    if (!redis) {
      return;
    }
    const cell = await redis.hget(driverKey(driverId), 'h3Cell');
    const tx = redis.multi().del(driverKey(driverId));
    if (cell) {
      tx.zrem(cellKey(cell), driverId);
    }
    await tx.exec();
  }

  /** Drops the presence of the driver behind an authenticated user. */
  async removeForUser(userId: string): Promise<void> {
    this.forgetUser(userId);
    const gate = await this.driverGate(userId);
    if (gate) {
      await this.remove(gate.id);
    }
  }

  /** Forgets the cached status gate so the next ping re-reads the database. */
  forgetUser(userId: string): void {
    this.gateByUser.delete(userId);
  }

  async get(driverId: string): Promise<PresenceRecord | null> {
    const [record] = await this.getMany([driverId]);
    return record ?? null;
  }

  /** Latest stored presence per driver; drivers with none are skipped. */
  async getMany(driverIds: string[]): Promise<PresenceRecord[]> {
    const redis = this.redis.client;
    if (!redis || driverIds.length === 0) {
      return [];
    }
    const pipeline = redis.pipeline();
    for (const id of driverIds) {
      pipeline.hgetall(driverKey(id));
    }
    const results = (await pipeline.exec()) ?? [];

    return results
      .map(([, value]) => parseRecord(value as Record<string, string>))
      .filter((record): record is PresenceRecord => record !== null);
  }

  /**
   * Drivers reported from any of `cells`, split into fresh (within the
   * presence TTL) and stale (older, still retained). Members past retention
   * are pruned on the way, so a cell never grows without bound.
   */
  async membersOfCells(
    cells: string[],
    now = new Date(),
  ): Promise<CellMembers> {
    const redis = this.redis.client;
    if (!redis || cells.length === 0) {
      return { fresh: [], stale: [] };
    }
    const freshSince = now.getTime() - this.config.presenceTtlSec * 1000;
    const keptSince = now.getTime() - this.retentionSec * 1000;
    const pipeline = redis.pipeline();
    for (const cell of cells) {
      pipeline.zremrangebyscore(cellKey(cell), '-inf', `(${keptSince}`);
      pipeline.zrangebyscore(cellKey(cell), keptSince, '+inf', 'WITHSCORES');
    }
    const results = (await pipeline.exec()) ?? [];
    const fresh = new Set<string>();
    const stale = new Set<string>();
    results.forEach(([, value], index) => {
      if (index % 2 === 0) {
        return;
      }
      const flat = value as string[];
      for (let i = 0; i < flat.length; i += 2) {
        (Number(flat[i + 1]) >= freshSince ? fresh : stale).add(flat[i]);
      }
    });
    for (const id of fresh) {
      stale.delete(id);
    }
    return { fresh: [...fresh], stale: [...stale] };
  }

  /**
   * Every driver with a fresh position, for the operations map. SCAN walks
   * the keyspace in chunks, so it never blocks Redis; fleets here are small.
   */
  async listFresh(now = new Date(), limit = 1000): Promise<PresenceRecord[]> {
    const redis = this.redis.client;
    if (!redis) {
      return [];
    }
    const ids: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        driverKey('*'),
        'COUNT',
        200,
      );
      cursor = next;
      ids.push(...keys.map((key) => key.slice(driverKey('').length)));
    } while (cursor !== '0' && ids.length < limit);

    const records = await this.getMany(ids.slice(0, limit));
    return records.filter((record) => this.isFresh(record, now));
  }

  /** Number of fresh drivers across `cells`, for supply/demand ratios. */
  async countFreshInCells(cells: string[], now = new Date()): Promise<number> {
    return (await this.membersOfCells(cells, now)).fresh.length;
  }

  /** Whether a stored record is recent enough to rank. */
  isFresh(record: PresenceRecord, now = new Date()): boolean {
    return (
      now.getTime() - record.observedAt.getTime() <=
      this.config.presenceTtlSec * 1000
    );
  }

  private get retentionSec(): number {
    return this.config.presenceTtlSec * RETENTION_TTL_MULTIPLIER;
  }

  private async noteRejection(
    previous: PresenceRecord | null,
    reason: PresenceRejection,
    now: Date,
  ): Promise<void> {
    if (!previous || !NOTED_REJECTIONS.has(reason) || !this.redis.client) {
      return;
    }
    await this.redis.client.hset(driverKey(previous.driverId), {
      lastRejection: reason,
      lastRejectedAt: now.toISOString(),
    });
  }

  private validate(
    input: PresenceInput,
    now: Date,
  ): PresenceRejection | undefined {
    const latitude = Number(input?.latitude);
    const longitude = Number(input?.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      return 'INVALID_COORDINATES';
    }
    if (!isInServiceArea({ latitude, longitude })) {
      return 'OUT_OF_SERVICE_AREA';
    }
    if (input.isMocked) {
      return 'MOCKED_LOCATION';
    }
    if (input.accuracyM == null || !Number.isFinite(Number(input.accuracyM))) {
      return 'MISSING_ACCURACY';
    }
    if (Number(input.accuracyM) > this.config.presenceMaxAccuracyM) {
      return 'LOW_ACCURACY';
    }

    const observedAt = input.observedAt ? new Date(input.observedAt) : now;
    if (Number.isNaN(observedAt.getTime())) {
      return 'STALE_TIMESTAMP';
    }
    if (observedAt.getTime() - now.getTime() > MAX_CLOCK_SKEW_MS) {
      return 'FUTURE_TIMESTAMP';
    }
    if (
      now.getTime() - observedAt.getTime() >
      this.config.presenceTtlSec * 1000
    ) {
      return 'STALE_TIMESTAMP';
    }
    return undefined;
  }

  private async driverGate(userId: string): Promise<DriverGate | null> {
    const cached = this.gateByUser.get(userId);
    if (cached !== undefined) {
      return cached;
    }
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId },
      select: { id: true, availabilityStatus: true, verificationStatus: true },
    });
    this.gateByUser.set(userId, driver);
    if (driver) {
      this.userByDriver.set(driver.id, userId);
    }
    return driver;
  }
}

function parseRecord(
  value: Record<string, string> | null | undefined,
): PresenceRecord | null {
  if (!value || !value.driverId || !value.h3Cell) {
    return null;
  }
  const optional = (raw: string | undefined) =>
    raw === undefined || raw === '' ? null : Number(raw);

  return {
    driverId: value.driverId,
    vehicleId: value.vehicleId || null,
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
    accuracyM: optional(value.accuracyM),
    heading: optional(value.heading),
    speed: optional(value.speed),
    observedAt: new Date(value.observedAt),
    receivedAt: new Date(value.receivedAt),
    status: value.status as STATUS_DRIVER,
    h3Cell: value.h3Cell,
    lastRejection: (value.lastRejection || null) as PresenceRejection | null,
    lastRejectedAt: value.lastRejectedAt
      ? new Date(value.lastRejectedAt)
      : null,
  };
}
