import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Prisma } from '@generated/prisma/client';
import type { DriverLocation, TrackingSession } from '@generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  ROLES,
  STATUS_ORDERS,
  TRACKING_SESSIONS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { trackingConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import type { CreateSessionDto } from './dto/create-session.dto';
import type { TrackingLocationDto } from './dto/tracking-location.dto';

interface DriverContext {
  driverId: string;
  vehicleId: string | null;
}

export interface BatchResult {
  sessionId: string;
  received: number;
  accepted: number;
  duplicates: number;
  lastSequence: number | null;
}

@Injectable()
export class TrackingSessionsService {
  private readonly logger = new Logger(TrackingSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(trackingConfig.KEY)
    private readonly config: ConfigType<typeof trackingConfig>,
  ) {}

  /** Creates a tracking session for the order, or returns the active one. */
  async createOrRecover(
    user: AuthenticatedUser,
    dto: CreateSessionDto,
  ): Promise<TrackingSession> {
    const ctx = await this.resolveContext(user, dto.orderId);

    const active = await this.prisma.trackingSession.findFirst({
      where: {
        orderId: dto.orderId,
        driverId: ctx.driverId,
        status: TRACKING_SESSIONS.ACTIVE,
      },
      orderBy: { startedAt: 'desc' },
    });

    if (active) {
      return active;
    }

    const now = new Date();
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.trackingSession.create({
        data: {
          orderId: dto.orderId,
          driverId: ctx.driverId,
          startedAt: now,
          status: TRACKING_SESSIONS.ACTIVE,
          lastLocationAt: null,
        },
      });

      await tx.transportOrder.update({
        where: { id: dto.orderId },
        data: { status: STATUS_ORDERS.IN_PROGRESS, pickupAt: now },
      });

      return created;
    });

    this.realtime.emitTripEvent(dto.orderId, 'tracking:started', session);
    return session;
  }

  /** Returns the driver's active session (optionally scoped to one order). */
  async getActive(
    user: AuthenticatedUser,
    orderId?: string,
  ): Promise<TrackingSession | null> {
    const driverId = await this.resolveDriverId(user);

    return this.prisma.trackingSession.findFirst({
      where: {
        status: TRACKING_SESSIONS.ACTIVE,
        ...(driverId ? { driverId } : {}),
        ...(orderId ? { orderId } : {}),
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  async addLocation(
    user: AuthenticatedUser,
    sessionId: string,
    dto: TrackingLocationDto,
  ): Promise<DriverLocation> {
    const session = await this.loadActiveSession(user, sessionId);
    const ctx = await this.resolveContext(user, session.orderId);
    const now = new Date();
    const recordedAt = new Date(dto.recordedAt);

    await this.classifyAnomalies(sessionId, dto, recordedAt);

    let location: DriverLocation;
    try {
      location = await this.prisma.driverLocation.create({
        data: this.toLocationData(session, ctx, dto, recordedAt, now),
      });
    } catch (error) {
      // Idempotency: a duplicate (sessionId, clientId) means we already stored it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        dto.clientId
      ) {
        const existing = await this.prisma.driverLocation.findFirst({
          where: { sessionId, clientId: dto.clientId },
        });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }

    await this.touchSession(sessionId, now);
    this.realtime.emitLocation(location);
    return location;
  }

  async addLocationBatch(
    user: AuthenticatedUser,
    sessionId: string,
    locations: TrackingLocationDto[],
  ): Promise<BatchResult> {
    const session = await this.loadActiveSession(user, sessionId);
    const ctx = await this.resolveContext(user, session.orderId);
    const now = new Date();

    const data = locations.map((dto) =>
      this.toLocationData(session, ctx, dto, new Date(dto.recordedAt), now),
    );

    // skipDuplicates makes the batch idempotent on the (sessionId, clientId) unique.
    const result = await this.prisma.driverLocation.createMany({
      data,
      skipDuplicates: true,
    });

    await this.touchSession(sessionId, now);

    const latest = await this.prisma.driverLocation.findFirst({
      where: { sessionId },
      orderBy: { recordedAt: 'desc' },
    });
    if (latest) {
      this.realtime.emitLocation(latest);
    }

    const summary: BatchResult = {
      sessionId,
      received: locations.length,
      accepted: result.count,
      duplicates: locations.length - result.count,
      lastSequence: locations.length
        ? Math.max(...locations.map((l) => l.sequence))
        : null,
    };
    this.realtime.emitTripEvent(
      session.orderId,
      'tracking:location.batch-processed',
      summary,
    );
    return summary;
  }

  async stop(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<TrackingSession> {
    const session = await this.loadSession(user, sessionId);
    if (session.status !== TRACKING_SESSIONS.ACTIVE) {
      return session;
    }

    const ended = await this.prisma.trackingSession.update({
      where: { id: sessionId },
      data: { status: TRACKING_SESSIONS.ENDED, endedAt: new Date() },
    });

    this.realtime.emitTripEvent(session.orderId, 'tracking:stopped', ended);
    return ended;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private toLocationData(
    session: TrackingSession,
    ctx: DriverContext,
    dto: TrackingLocationDto,
    recordedAt: Date,
    receivedAt: Date,
  ): Prisma.DriverLocationCreateManyInput {
    return {
      driverId: session.driverId,
      orderId: session.orderId,
      sessionId: session.id,
      vehicleId: ctx.vehicleId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy: dto.accuracyMeters ?? null,
      altitude: dto.altitudeMeters ?? null,
      speed: dto.speedMps ?? null,
      heading: dto.heading ?? null,
      batteryLevel: dto.batteryLevel ?? null,
      sequence: dto.sequence,
      isMocked: dto.isMocked ?? false,
      clientId: dto.clientId ?? null,
      recordedAt,
      receivedAt,
    };
  }

  private touchSession(sessionId: string, at: Date) {
    return this.prisma.trackingSession.update({
      where: { id: sessionId },
      data: { lastLocationAt: at },
    });
  }

  /** Logs (never rejects) points that look implausible, for later review. */
  private async classifyAnomalies(
    sessionId: string,
    dto: TrackingLocationDto,
    recordedAt: Date,
  ): Promise<void> {
    if (
      dto.accuracyMeters !== undefined &&
      dto.accuracyMeters > this.config.maxAccuracyMeters
    ) {
      this.logger.warn(
        `Low-accuracy fix on session ${sessionId}: ${dto.accuracyMeters}m > ${this.config.maxAccuracyMeters}m`,
      );
    }

    const previous = await this.prisma.driverLocation.findFirst({
      where: { sessionId },
      orderBy: { recordedAt: 'desc' },
    });
    if (!previous) {
      return;
    }

    const dtSeconds =
      (recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
    if (dtSeconds <= 0) {
      this.logger.warn(
        `Out-of-order fix on session ${sessionId}: recordedAt not increasing`,
      );
      return;
    }

    const meters = this.haversineMeters(
      Number(previous.latitude),
      Number(previous.longitude),
      dto.latitude,
      dto.longitude,
    );
    const impliedSpeed = meters / dtSeconds;
    if (impliedSpeed > this.config.maxSpeedMps) {
      this.logger.warn(
        `Impossible jump on session ${sessionId}: ${impliedSpeed.toFixed(1)} m/s over ${dtSeconds.toFixed(1)}s`,
      );
    }
  }

  private async loadSession(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<TrackingSession> {
    const session = await this.prisma.trackingSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Tracking session not found',
      });
    }

    if (this.isPrivileged(user)) {
      return session;
    }

    const driver = await this.getDriverProfile(user);
    if (driver.id !== session.driverId) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Session does not belong to this driver',
      });
    }
    return session;
  }

  private async loadActiveSession(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<TrackingSession> {
    const session = await this.loadSession(user, sessionId);
    if (session.status !== TRACKING_SESSIONS.ACTIVE) {
      throw new ForbiddenException({
        code: ERROR_CODES.DOMAIN_RULE_VIOLATION,
        message: 'Tracking session is not active',
      });
    }
    return session;
  }

  /** Resolves {driverId, vehicleId} from the driver's active assignment. */
  private async resolveContext(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<DriverContext> {
    const where = this.isPrivileged(user)
      ? {
          orderId,
          assignmentStatus: {
            in: [ASSIGNMENT_STATUS.ACCEPTED],
          },
        }
      : {
          orderId,
          driverId: (await this.getDriverProfile(user)).id,
          assignmentStatus: {
            in: [ASSIGNMENT_STATUS.ACCEPTED],
          },
        };

    const assignment = await this.prisma.orderAssignment.findFirst({
      where,
      orderBy: { assignedAt: 'desc' },
    });

    if (!assignment) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Driver is not assigned to this order',
      });
    }

    return { driverId: assignment.driverId, vehicleId: assignment.vehicleId };
  }

  private async resolveDriverId(
    user: AuthenticatedUser,
  ): Promise<string | null> {
    if (!user.roles.includes(ROLES.DRIVER)) {
      return null;
    }
    return (await this.getDriverProfile(user)).id;
  }

  private async getDriverProfile(user: AuthenticatedUser) {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
    });
    if (!driver) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Driver profile not found',
      });
    }
    return driver;
  }

  private isPrivileged(user: AuthenticatedUser): boolean {
    return user.roles.some(
      (role) => role === ROLES.ADMIN || role === ROLES.OPERATOR,
    );
  }

  private haversineMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6_371_000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
