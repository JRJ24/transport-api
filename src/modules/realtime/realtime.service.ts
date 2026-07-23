import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { DriverLocation } from '@generated/prisma/client';
import { ASSIGNMENT_STATUS, ROLES } from '@generated/prisma/enums';
import { Server, type Socket } from 'socket.io';
import { TokenType } from '@/common/enums/token-type.enum';
import { permissionsForRoles } from '@/common/enums/permission.enum';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { JwtPayload } from '@/common/interfaces/jwt-payload.interface';
import { appConfig, authConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { SessionsService } from '@/modules/identity/sessions/sessions.service';

interface TrackingLocationPayload {
  driverId?: string;
  orderId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  batteryLevel?: number;
  recordedAt?: string;
}

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private io?: Server;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly jwtService: JwtService,
    private readonly sessionsService: SessionsService,
    private readonly prisma: PrismaService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  onModuleInit(): void {
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer();

    if (!httpServer) {
      this.logger.warn('Socket.IO server was not started: no HTTP adapter');
      return;
    }

    this.io = new Server(httpServer, {
      cors: { origin: this.app.corsOrigins, credentials: true },
      path: '/socket.io',
    });

    this.io.use((socket, next) => {
      void this.authenticateSocket(socket)
        .then((user) => {
          socket.data.user = user;
          next();
        })
        .catch((error: unknown) =>
          next(
            error instanceof Error ? error : new Error('Unauthorized socket'),
          ),
        );
    });

    this.io.on('connection', (socket) => void this.handleConnection(socket));
    this.logger.log('Socket.IO tracking gateway started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.io?.close();
  }

  emitLocation(location: DriverLocation): void {
    if (!this.io) {
      return;
    }

    const payload = this.serializeLocation(location);
    const event = 'tracking:location.updated';
    this.io.to(`order:${location.orderId}`).emit(event, payload);
    this.io.to(`driver:${location.driverId}`).emit(event, payload);
    if (location.vehicleId) {
      this.io.to(`vehicle:${location.vehicleId}`).emit(event, payload);
    }
    this.io.to('tracking:operations').emit(event, payload);
    // Backwards-compatible legacy event name.
    this.io.to(`order:${location.orderId}`).emit('tracking:location', payload);
  }

  emitTripEvent(orderId: string, event: string, data: unknown): void {
    if (!this.io) {
      return;
    }

    this.io.to(`order:${orderId}`).emit(event, data);
    this.io.to('tracking:operations').emit(event, data);
  }

  /** Broadcasts an order-status change to watchers of that order + operations. */
  emitOrderStatusChanged(payload: {
    orderId: string;
    status: string;
    previousStatus?: string;
    changedByUserId?: string;
    changedAt: string;
  }): void {
    if (!this.io) {
      return;
    }
    this.io
      .to(`order:${payload.orderId}`)
      .emit('order.status.changed', payload);
    this.io.to('tracking:operations').emit('order.status.changed', payload);
  }

  /** Broadcasts a newly created order to the TMS operations room. */
  emitOrderCreated(payload: {
    orderId: string;
    orderCode: string;
    status: string;
    serviceType?: string;
    createdByUserId?: string;
    createdAt: string;
  }): void {
    this.io?.to('tracking:operations').emit('order.created', payload);
    this.io?.to('drivers:requests').emit('order.created', payload);
  }

  /** Notifies the assigned driver and TMS when an assignment is created. */
  emitAssignmentCreated(payload: {
    assignmentId: string;
    orderId: string;
    driverId: string;
    vehicleId: string;
    assignmentStatus: string;
    assignedAt: string;
  }): void {
    this.io
      ?.to(`driver:${payload.driverId}`)
      .emit('assignment.created', payload);
    this.io?.to('tracking:operations').emit('assignment.created', payload);
  }

  /** Broadcasts a new incident to operators watching the control tower. */
  emitIncidentCreated(payload: {
    incidentId: string;
    orderId: string;
    title: string;
    severity: string;
    status: string;
    reportedBy?: string;
    reportedAt: string;
  }): void {
    this.io?.to('tracking:operations').emit('incident.created', payload);
  }

  /** Broadcasts incident updates that should refresh badges and inboxes. */
  emitIncidentUpdated(payload: {
    incidentId: string;
    orderId: string;
    status: string;
    severity?: string;
    updatedAt: string;
  }): void {
    this.io?.to('tracking:operations').emit('incident.updated', payload);
  }

  /** Pushes a realtime notification to a specific user's personal room. */
  emitToUser(userId: string, event: string, data: unknown): void {
    this.io?.to(`user:${userId}`).emit(event, data);
  }

  emitNotificationCreated(userId: string, notification: unknown): void {
    this.emitToUser(userId, 'notification.created', notification);
  }

  private async handleConnection(socket: Socket): Promise<void> {
    const user = socket.data.user as AuthenticatedUser;
    this.logger.debug(`Socket connected for ${user.email}`);

    // Personal room for targeted notifications.
    void socket.join(`user:${user.id}`);

    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      void socket.join('tracking:operations');
    }

    // Drivers auto-join their own driver room so they receive their live feed.
    if (user.roles.includes(ROLES.DRIVER)) {
      const driver = await this.prisma.driverProfile.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });
      if (driver) {
        void socket.join(`driver:${driver.id}`);
        void socket.join('drivers:requests');
      }
    }

    socket.on('tracking:join-order', async (payload: { orderId?: string }) => {
      if (
        typeof payload?.orderId !== 'string' ||
        payload.orderId.length === 0
      ) {
        return;
      }
      // Authorize: never let a client subscribe to an arbitrary order room.
      const allowed = await this.canViewOrder(user, payload.orderId);
      if (!allowed) {
        socket.emit('tracking:error', {
          message: 'Not authorized to watch this order',
        });
        return;
      }
      await socket.join(`order:${payload.orderId}`);
    });

    socket.on('tracking:leave-order', async (payload: { orderId?: string }) => {
      if (typeof payload?.orderId === 'string' && payload.orderId.length > 0) {
        await socket.leave(`order:${payload.orderId}`);
      }
    });

    socket.on(
      'tracking:driver-location',
      async (
        payload: TrackingLocationPayload,
        ack?: (response: {
          success: boolean;
          data?: unknown;
          error?: string;
        }) => void,
      ) => {
        try {
          const location = await this.recordSocketLocation(user, payload);
          ack?.({ success: true, data: this.serializeLocation(location) });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Location rejected';
          socket.emit('tracking:error', { message });
          ack?.({ success: false, error: message });
        }
      },
    );
  }

  private async authenticateSocket(socket: Socket): Promise<AuthenticatedUser> {
    const authToken = socket.handshake.auth?.token;
    const header = socket.handshake.headers.authorization;
    const token =
      typeof authToken === 'string'
        ? authToken
        : typeof header === 'string' && header.startsWith('Bearer ')
          ? header.slice('Bearer '.length)
          : undefined;

    if (!token) {
      throw new Error('Socket authentication token is required');
    }

    const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: this.auth.accessSecret,
    });

    if (payload.type !== TokenType.ACCESS) {
      throw new Error('Invalid socket token type');
    }

    const session = await this.sessionsService.findValidWithUser(
      payload.sessionId,
    );

    if (!session || session.userId !== payload.sub) {
      throw new Error('Socket session is no longer valid');
    }

    const roles = session.user.userRoles.map((userRole) => userRole.rol.code);

    return {
      id: session.user.id,
      email: session.user.email,
      fullName: session.user.fullName,
      status: session.user.status,
      roles,
      permissions: permissionsForRoles(roles),
      sessionId: session.id,
    };
  }

  private async recordSocketLocation(
    user: AuthenticatedUser,
    payload: TrackingLocationPayload,
  ): Promise<DriverLocation> {
    this.assertLocationPayload(payload);
    const driverId = await this.resolveDriverId(user, payload.driverId);

    await this.assertDriverCanTrackOrder(user, driverId, payload.orderId);

    const now = new Date();
    const recordedAt = payload.recordedAt ? new Date(payload.recordedAt) : now;

    const location = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.driverLocation.create({
        data: {
          driverId,
          orderId: payload.orderId,
          latitude: payload.latitude,
          longitude: payload.longitude,
          accuracy: payload.accuracy ?? null,
          speed: payload.speed ?? null,
          batteryLevel: payload.batteryLevel ?? null,
          recordedAt,
          receivedAt: now,
        },
      });

      await tx.trackingSession.updateMany({
        where: { orderId: payload.orderId, driverId, endedAt: null },
        data: { lastLocationAt: now },
      });

      return saved;
    });

    this.emitLocation(location);
    return location;
  }

  private async resolveDriverId(
    user: AuthenticatedUser,
    requestedDriverId?: string,
  ): Promise<string> {
    if (user.roles.includes(ROLES.DRIVER)) {
      const driver = await this.prisma.driverProfile.findFirst({
        where: { userId: user.id },
      });

      if (!driver) {
        throw new Error('Driver profile not found for authenticated user');
      }

      if (requestedDriverId && requestedDriverId !== driver.id) {
        throw new Error('Driver cannot publish location for another profile');
      }

      return driver.id;
    }

    if (!requestedDriverId) {
      throw new Error(
        'driverId is required for operator/admin socket tracking',
      );
    }

    return requestedDriverId;
  }

  private async assertDriverCanTrackOrder(
    user: AuthenticatedUser,
    driverId: string,
    orderId: string,
  ): Promise<void> {
    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      return;
    }

    const assignment = await this.prisma.orderAssignment.findFirst({
      where: {
        driverId,
        orderId,
        assignmentStatus: {
          in: [ASSIGNMENT_STATUS.ACCEPTED, ASSIGNMENT_STATUS.PENDING],
        },
      },
    });

    if (!assignment) {
      throw new Error('Driver is not assigned to this order');
    }
  }

  /** Whether the user may subscribe to an order's realtime room. */
  private async canViewOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<boolean> {
    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      return true;
    }

    if (user.roles.includes(ROLES.DRIVER)) {
      const driver = await this.prisma.driverProfile.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!driver) {
        return false;
      }
      const assignment = await this.prisma.orderAssignment.findFirst({
        where: { orderId, driverId: driver.id },
        select: { id: true },
      });
      if (assignment) {
        return true;
      }
    }

    if (user.roles.includes(ROLES.CUSTOMER)) {
      const order = await this.prisma.transportOrder.findUnique({
        where: { id: orderId },
        select: { customer: { select: { userId: true } } },
      });
      if (order?.customer?.userId === user.id) {
        return true;
      }
    }

    return false;
  }

  private assertLocationPayload(payload: TrackingLocationPayload): void {
    if (!payload?.orderId || typeof payload.orderId !== 'string') {
      throw new Error('orderId is required');
    }

    if (
      !Number.isFinite(Number(payload.latitude)) ||
      !Number.isFinite(Number(payload.longitude))
    ) {
      throw new Error('latitude and longitude are required numbers');
    }
  }

  private serializeLocation(location: DriverLocation) {
    return {
      id: location.id,
      driverId: location.driverId,
      orderId: location.orderId,
      sessionId: location.sessionId,
      vehicleId: location.vehicleId,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracy: location.accuracy === null ? null : Number(location.accuracy),
      altitude: location.altitude === null ? null : Number(location.altitude),
      speed: location.speed === null ? null : Number(location.speed),
      heading: location.heading === null ? null : Number(location.heading),
      batteryLevel: location.batteryLevel,
      sequence: location.sequence,
      isMocked: location.isMocked,
      recordedAt: location.recordedAt.toISOString(),
      receivedAt: location.receivedAt.toISOString(),
    };
  }
}
