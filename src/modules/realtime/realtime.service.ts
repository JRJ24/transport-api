import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
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
import { appConfig, authConfig, matchingConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { SessionsService } from '@/modules/identity/sessions/sessions.service';
import {
  PresenceService,
  type PresenceInput,
  type PresenceResult,
} from '@/modules/operations/presence/presence.service';
import { RuntimeSettingsService } from '@/modules/administration/settings/runtime-settings.service';

/** Perfil del conductor de una conexion, consultado una vez y compartido. */
type DriverLookup = () => Promise<{ id: string } | null>;

/**
 * Asignaciones que dejan a un conductor entrar a order:{id}. REJECTED y
 * CANCELLED no: ese conductor ya no lleva la orden, y sus cambios le llegan
 * por driver:{id} cuando lo incluyen en driverIds. Esto solo se mira al
 * entrar; quien ya estaba dentro sale con revokeOrderRoom cuando su
 * asignacion se cierra.
 */
const WATCHABLE_ASSIGNMENT_STATUSES: ASSIGNMENT_STATUS[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.COMPLETED,
];

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
    private readonly presence: PresenceService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
    @Inject(matchingConfig.KEY)
    private readonly matching: ConfigType<typeof matchingConfig>,
    @Optional() private readonly settings?: RuntimeSettingsService,
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

    this.io.on('connection', (socket) => this.handleConnection(socket));
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

  /**
   * Broadcasts an order-status change to watchers of that order, to the
   * drivers assigned to it and to operations.
   *
   * driverIds solo enruta: la app del conductor recarga sus asignaciones con
   * este evento, pero solo estaba en order:{id} de la orden abierta, asi que
   * una cancelacion de otra orden suya no le llegaba. Va en UNA sola emision
   * a todas las rooms para que socket.io no lo duplique a quien este en
   * varias, y se quita del payload para que los clientes reciban lo mismo
   * que antes.
   */
  emitOrderStatusChanged(payload: {
    orderId: string;
    status: string;
    previousStatus?: string;
    changedByUserId?: string;
    changedAt: string;
    driverIds?: string[];
  }): void {
    if (!this.io) {
      return;
    }
    const { driverIds, ...event } = payload;
    const driverRooms = [...new Set(driverIds ?? [])]
      .filter(Boolean)
      .map((driverId) => `driver:${driverId}`);
    this.io
      .to([`order:${event.orderId}`, ...driverRooms])
      .emit('order.status.changed', event);
    this.io.to('tracking:operations').emit('order.status.changed', event);
  }

  /**
   * Saca de order:{orderId} todas las conexiones del conductor.
   *
   * canViewOrder solo se evalua en tracking:join-order: un conductor que entro
   * con la asignacion PENDING y despues la rechazo (o se la cancelaron) seguia
   * en la room y recibia la ubicacion en vivo y los cambios de estado del
   * conductor siguiente. Se llama despues del commit y despues de emitir el
   * order.status.changed que lo avisa: ese evento le llega igual por
   * driver:{id}. Va por driver:{id} porque todo socket de conductor que entra a
   * una orden esta en esa room (joinDriverRooms al conectar, y join-order la
   * asegura). Sin io (no hay servidor HTTP, p. ej. en tests) no hay rooms.
   */
  revokeOrderRoom(driverId: string, orderId: string): void {
    if (!driverId || !orderId) {
      return;
    }
    this.io?.in(`driver:${driverId}`).socketsLeave(`order:${orderId}`);
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
    // With automatic offers on, drivers hear about an order only through an
    // offer made to them, never through a broadcast they could race on.
    const auto =
      this.settings?.get('matching.auto_offer') ??
      this.matching.autoOffer === 'on';
    if (!auto) {
      this.io?.to('drivers:requests').emit('order.created', payload);
    }
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

  /**
   * Where the automatic search for a driver stands, for the customer and TMS
   * watching the order: offering to someone, or nobody nearby.
   */
  emitMatchingStatus(payload: {
    orderId: string;
    state: 'SEARCHING' | 'OFFERING' | 'NO_DRIVERS';
    attempt: number;
    etaSeconds?: number | null;
    expiresAt?: string | null;
    at: string;
  }): void {
    this.io?.to(`order:${payload.orderId}`).emit('matching.status', payload);
    this.io?.to('tracking:operations').emit('matching.status', payload);
  }

  /** A dispatch offer was made to a driver, or its state changed. */
  emitOfferUpdated(payload: {
    offerId: string;
    orderId: string;
    driverId: string;
    status: string;
    mode: string;
    rank: number;
    etaSeconds: number | null;
    expiresAt: string | null;
  }): void {
    this.io?.to(`driver:${payload.driverId}`).emit('offer.updated', payload);
    this.io?.to('tracking:operations').emit('offer.updated', payload);
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

  private handleConnection(socket: Socket): void {
    const user = socket.data.user as AuthenticatedUser;
    this.logger.debug(`Socket connected for ${user.email}`);

    // Personal room for targeted notifications.
    void socket.join(`user:${user.id}`);

    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      void socket.join('tracking:operations');
    }

    const driverOf = this.memoizedDriverLookup(user);

    // Los listeners se registran antes de cualquier await: socket.io descarta
    // los eventos que llegan sin listener, y la app movil re-emite
    // tracking:join-order apenas recibe 'connect'. Con la consulta del perfil
    // delante, esas rooms se perdian en cada reconexion.
    this.registerSocketHandlers(socket, user, driverOf);

    // Drivers auto-join their own driver room so they receive their live feed.
    if (user.roles.includes(ROLES.DRIVER)) {
      void this.joinDriverRooms(socket, user, driverOf);
    }
  }

  /**
   * Una sola consulta del perfil por conexion: la app se une a todas sus
   * ordenes asignadas al conectar. Solo se recuerda un perfil encontrado, para
   * no negarle las rooms a uno creado despues de conectar ni fijar un error.
   */
  private memoizedDriverLookup(user: AuthenticatedUser): DriverLookup {
    let pending: Promise<{ id: string } | null> | null = null;
    return () => {
      pending ??= this.prisma.driverProfile
        .findFirst({ where: { userId: user.id }, select: { id: true } })
        .then(
          (driver) => {
            if (!driver) {
              pending = null;
            }
            return driver;
          },
          (error: unknown) => {
            pending = null;
            throw error;
          },
        );
      return pending;
    };
  }

  private async joinDriverRooms(
    socket: Socket,
    user: AuthenticatedUser,
    driverOf: DriverLookup,
  ): Promise<void> {
    try {
      const driver = await driverOf();
      // Si el socket se cerro mientras tanto, unirlo dejaria su id colgado
      // en las rooms del adapter.
      if (driver && socket.connected) {
        void socket.join(`driver:${driver.id}`);
        void socket.join('drivers:requests');
      }
    } catch (error) {
      this.logger.error(
        `Driver rooms failed for ${user.id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * revokeOrderRoom llega a las conexiones del conductor por driver:{id}. Si
   * la consulta del perfil fallo al conectar, joinDriverRooms no la unio, pero
   * join-order vuelve a consultar (el memo no guarda errores) y podia meterla
   * en order:{id} fuera del alcance de la revocacion. Unirla aqui cierra ese
   * hueco; con el perfil ya en memoria no cuesta otra consulta.
   */
  private async ensureDriverRoom(
    socket: Socket,
    user: AuthenticatedUser,
    driverOf: DriverLookup,
  ): Promise<void> {
    if (!user.roles.includes(ROLES.DRIVER)) {
      return;
    }
    const driver = await driverOf();
    if (driver) {
      await socket.join(`driver:${driver.id}`);
    }
  }

  private registerSocketHandlers(
    socket: Socket,
    user: AuthenticatedUser,
    driverOf: DriverLookup,
  ): void {
    socket.on('tracking:join-order', async (payload: { orderId?: string }) => {
      if (
        typeof payload?.orderId !== 'string' ||
        payload.orderId.length === 0
      ) {
        return;
      }
      // Un listener async que rechaza es un unhandledRejection, y en Node eso
      // termina el proceso: un fallo de la base de datos se reporta al cliente.
      try {
        // Authorize: never let a client subscribe to an arbitrary order room.
        const allowed = await this.canViewOrder(
          user,
          payload.orderId,
          driverOf,
        );
        if (!allowed) {
          socket.emit('tracking:error', {
            message: 'Not authorized to watch this order',
          });
          return;
        }
        // Como en joinDriverRooms: unir un socket ya cerrado deja su id
        // colgado en las rooms del adapter.
        if (!socket.connected) {
          return;
        }
        await this.ensureDriverRoom(socket, user, driverOf);
        await socket.join(`order:${payload.orderId}`);
      } catch (error) {
        this.logger.error(
          `Join order failed for ${user.id}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        socket.emit('tracking:error', {
          message: 'Could not join this order right now',
        });
      }
    });

    socket.on('tracking:leave-order', async (payload: { orderId?: string }) => {
      if (typeof payload?.orderId === 'string' && payload.orderId.length > 0) {
        await socket.leave(`order:${payload.orderId}`);
      }
    });

    // Presence of an available driver, used for H3 candidate search. Unlike
    // tracking:driver-location it needs no order and is never persisted in
    // Postgres: it lives in Redis for PRESENCE_TTL_SEC and then disappears,
    // which is also why a dropped socket needs no explicit cleanup.
    socket.on(
      'driver:presence',
      async (
        payload: PresenceInput,
        ack?: (
          response: PresenceResult | { accepted: false; reason: string },
        ) => void,
      ) => {
        if (!user.roles.includes(ROLES.DRIVER)) {
          ack?.({ accepted: false, reason: 'NOT_A_DRIVER' });
          return;
        }
        try {
          ack?.(await this.presence.recordForUser(user.id, payload));
        } catch (error) {
          this.logger.error(
            `Presence failed for ${user.id}: ${error instanceof Error ? error.message : 'unknown'}`,
          );
          ack?.({ accepted: false, reason: 'PRESENCE_UNAVAILABLE' });
        }
      },
    );

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
          in: [ASSIGNMENT_STATUS.ACCEPTED],
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
    driverOf: DriverLookup = this.memoizedDriverLookup(user),
  ): Promise<boolean> {
    if (
      user.roles.some((role) => role === ROLES.ADMIN || role === ROLES.OPERATOR)
    ) {
      return true;
    }

    if (user.roles.includes(ROLES.DRIVER)) {
      const driver = await driverOf();
      if (!driver) {
        return false;
      }
      // Con cualquier asignacion bastaba: quien rechazo la orden podia seguir
      // en su room y ver la ubicacion en vivo del conductor que la tomo
      // despues. Misma regla que EVIDENCE_READ_ASSIGNMENT_STATUSES
      // (EvidenceAccessService); a quien ya estaba dentro lo saca
      // revokeOrderRoom.
      const assignment = await this.prisma.orderAssignment.findFirst({
        where: {
          orderId,
          driverId: driver.id,
          assignmentStatus: { in: WATCHABLE_ASSIGNMENT_STATUSES },
        },
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
