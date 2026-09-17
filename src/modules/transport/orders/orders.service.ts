import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, TransportOrder } from '@generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  EVENT_TYPE,
  PAYMENT_STATUS,
  QUOTE_STATUS,
  RESERVATIONS_STATUS,
  ROLES,
  SERVICE_TYPE,
  STATUS_ACCOUNT,
  STATUS_DRIVER,
  STATUS_ORDERS,
  STATUS_VEHICLE,
  STOP_TYPE,
  VERIFICATION_STATUS,
} from '@generated/prisma/enums';
import type { OrderAssignment } from '@generated/prisma/client';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { DomainException } from '@/common/exceptions/domain.exception';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import { RealtimeService } from '@/modules/realtime/realtime.service';
import { AssignmentsService } from '@/modules/operations/assignments/assignments.service';
import { NotificationDispatcherService } from '@/modules/support/notifications/notification-dispatcher.service';
import type { NotificationEvent } from '@/modules/support/notifications/templates/notification.templates';
import { orderStatusLabel } from '@/modules/support/notifications/templates/notification.templates';
import {
  PricingService,
  type ManualQuoteInput,
} from '../pricing/pricing.service';
import type { CreateOrderManualQuoteDto } from '../pricing/dto/manual-quote.dto';
import type { CancelOrderDto } from './dto/cancel-order.dto';
import type { ClaimOrderDto } from './dto/claim-order.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import {
  TMS_ORDER_SUBMIT_MODE,
  type CreateTmsOrderDto,
} from './dto/create-tms-order.dto';
import type { OrderQueryDto } from './dto/order-query.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';

/**
 * Allowed order-status transitions. Terminal states have no outgoing edges.
 */
const STATUS_TRANSITIONS: Record<STATUS_ORDERS, STATUS_ORDERS[]> = {
  [STATUS_ORDERS.DRAFT]: [
    STATUS_ORDERS.PENDING_QUOTE,
    STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
    STATUS_ORDERS.REQUESTED,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.PENDING_QUOTE]: [
    STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION]: [
    STATUS_ORDERS.PENDING_PAYMENT,
    STATUS_ORDERS.CONFIRMED,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.PENDING_PAYMENT]: [
    STATUS_ORDERS.REQUESTED,
    STATUS_ORDERS.CONFIRMED,
    STATUS_ORDERS.CANCELLED,
    STATUS_ORDERS.FAILED,
  ],
  [STATUS_ORDERS.CONFIRMED]: [
    STATUS_ORDERS.ASSIGNING_DRIVER,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.ASSIGNING_DRIVER]: [
    STATUS_ORDERS.ASSIGNED,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.REQUESTED]: [
    STATUS_ORDERS.ASSIGNED,
    STATUS_ORDERS.PENDING_PAYMENT,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.ASSIGNED]: [
    STATUS_ORDERS.ACCEPTED,
    STATUS_ORDERS.REQUESTED,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.ACCEPTED]: [
    STATUS_ORDERS.IN_PROGRESS,
    STATUS_ORDERS.FAILED,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.IN_PROGRESS]: [
    STATUS_ORDERS.DELIVERED,
    STATUS_ORDERS.FAILED,
    STATUS_ORDERS.CANCELLED,
  ],
  [STATUS_ORDERS.DELIVERED]: [],
  [STATUS_ORDERS.CANCELLED]: [],
  [STATUS_ORDERS.FAILED]: [],
};

/** Transitions a DRIVER may perform themselves (start service, complete, fail). */
const DRIVER_TRANSITIONS = new Set<STATUS_ORDERS>([
  STATUS_ORDERS.IN_PROGRESS,
  STATUS_ORDERS.DELIVERED,
  STATUS_ORDERS.FAILED,
]);

const MANUAL_QUOTE_STATUSES = new Set<STATUS_ORDERS>([
  STATUS_ORDERS.DRAFT,
  STATUS_ORDERS.PENDING_QUOTE,
  STATUS_ORDERS.REQUESTED,
  STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION,
]);

const DISPATCHABLE_PAYMENT_STATUSES: PAYMENT_STATUS[] = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.AUTHORIZED,
];

const ACTIVE_ASSIGNMENT_STATUSES: ASSIGNMENT_STATUS[] = [
  ASSIGNMENT_STATUS.PENDING,
  ASSIGNMENT_STATUS.ACCEPTED,
];

const ACTIVE_DRIVER_ORDER_STATUSES: STATUS_ORDERS[] = [
  STATUS_ORDERS.ASSIGNED,
  STATUS_ORDERS.ACCEPTED,
  STATUS_ORDERS.IN_PROGRESS,
];

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ORDER_INCLUDE = {
  orderStops: true,
  orderItems: true,
  customer: { include: { user: { select: SAFE_USER_SELECT } } },
  vehicleCategory: true,
  orderAssignments: {
    include: {
      driver: { include: { user: { select: SAFE_USER_SELECT } } },
      vehicle: true,
    },
  },
  orderEvents: { orderBy: { createdAt: 'asc' as const } },
  quote: true,
  reservations: true,
  payments: {
    include: {
      paymentsTransactions: { orderBy: { createdAt: 'desc' as const } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
};

type OrderWithStopsAndItems = Prisma.TransportOrderGetPayload<{
  include: { orderStops: true; orderItems: true };
}>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly assignments: AssignmentsService,
    private readonly notifications: NotificationDispatcherService,
    private readonly pricing: PricingService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateOrderDto,
  ): Promise<TransportOrder> {
    const customer = await this.getCustomerProfile(user.id);
    const quote = await this.prisma.priceQuote.findFirst({
      where: { id: dto.quoteId, customerId: customer.id },
      include: { vehicleCategory: true },
    });

    if (!quote) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Price quote not found for this customer',
      });
    }

    if (quote.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Price quote is expired',
      });
    }

    if (dto.serviceType === SERVICE_TYPE.SCHEDULED && !dto.scheduleAt) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'scheduleAt is required for scheduled orders',
      });
    }

    this.assertVehicleCategoryCapacity(dto, quote.vehicleCategory);

    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.transportOrder.create({
        data: {
          orderCode: this.generateOrderCode(),
          customerId: customer.id,
          quoteId: quote.id,
          vehicleCategoryId: quote.vehicleCategoryId,
          serviceType: dto.serviceType,
          status: STATUS_ORDERS.PENDING_PAYMENT,
          scheduleAt: dto.scheduleAt ?? null,
          distanceKm: quote.distanceKm,
          estimatedDurationMin: quote.estimatedDurationMin,
          totalAmount: quote.totalAmount,
          paymentStatus: PAYMENT_STATUS.PENDING,
          notes: dto.notes?.trim() ?? '',
          orderStops: {
            create: dto.stops.map((stop) => ({
              stopType: stop.stopType,
              sequence: stop.sequence,
              contactName: stop.contactName.trim(),
              contactPhone: stop.contactPhone.trim(),
              addressLine: stop.addressLine.trim(),
              city: stop.city.trim(),
              province: stop.province.trim(),
              latitude: stop.latitude ?? null,
              longitude: stop.longitude ?? null,
              instructions: stop.instructions?.trim() ?? null,
            })),
          },
          orderItems: {
            create: dto.items.map((item) => ({
              description: item.description.trim(),
              quantity: item.quantity,
              weightKg: item.weightKg,
              volumeM3: item.volumeM3 ?? null,
              declaredValue: item.declaredValue ?? null,
              fragile: item.fragile ?? false,
              requireHelper: item.requireHelper ?? false,
            })),
          },
          orderEvents: {
            create: {
              eventType: EVENT_TYPE.CREATED,
              actorUserId: user.id,
              description: 'Order created',
              metadata: { source: 'api-v1' },
              latitude: null,
              longitude: 0,
            },
          },
        },
        include: ORDER_INCLUDE,
      });

      if (dto.serviceType === SERVICE_TYPE.SCHEDULED && dto.scheduleAt) {
        await tx.reservation.create({
          data: {
            orderId: order.id,
            reservedFor: dto.scheduleAt,
            reservationStatus: 'ACTIVE',
            rescheduleCount: 0,
            cancellationDeadline: new Date(
              dto.scheduleAt.getTime() - 60 * 60_000,
            ),
            createdAt: new Date(),
          },
        });
      }

      return order;
    });

    this.emitOrderCreated(order, user.id);
    void this.notifyOperators('ORDER_CREATED', order).catch((error: unknown) =>
      this.logger.error(
        `Failed to notify operators about new order: ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );

    return order;
  }

  async createFromTms(
    user: AuthenticatedUser,
    dto: CreateTmsOrderDto,
  ): Promise<TransportOrder> {
    if (dto.serviceType === SERVICE_TYPE.SCHEDULED && !dto.scheduleAt) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'scheduleAt is required for scheduled orders',
      });
    }

    const [customer, vehicleCategory] = await Promise.all([
      this.prisma.customerProfile.findUnique({
        where: { id: dto.customerId },
        include: { user: { select: { status: true } } },
      }),
      this.prisma.vehicleCategory.findUnique({
        where: { id: dto.vehicleCategoryId },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    if (customer.user.status !== STATUS_ACCOUNT.ACTIVE) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Customer account is not active',
      });
    }

    if (!vehicleCategory) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Vehicle category not found',
      });
    }

    this.assertVehicleCategoryCapacity(dto, vehicleCategory);

    const submitMode = dto.submitMode ?? TMS_ORDER_SUBMIT_MODE.DRAFT;
    const manualQuoteInput =
      submitMode === TMS_ORDER_SUBMIT_MODE.CREATE_AND_QUOTE && !dto.quoteId
        ? this.manualQuoteInputForTmsOrder(dto)
        : null;

    if (
      submitMode === TMS_ORDER_SUBMIT_MODE.CREATE_AND_QUOTE &&
      !dto.quoteId &&
      !manualQuoteInput
    ) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Manual quote data is required to create and quote an order',
      });
    }

    const manualQuoteCalculation = manualQuoteInput
      ? await this.pricing.calculateManualQuote(user, manualQuoteInput)
      : null;
    const hasCalculatedQuote =
      submitMode === TMS_ORDER_SUBMIT_MODE.CREATE_AND_QUOTE &&
      (Boolean(dto.quoteId) || Boolean(manualQuoteCalculation));
    const initialStatus = hasCalculatedQuote
      ? STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION
      : STATUS_ORDERS.DRAFT;

    const order = await this.prisma.$transaction(async (tx) => {
      const quote = dto.quoteId
        ? await tx.priceQuote.findFirst({
            where: { id: dto.quoteId, customerId: dto.customerId },
          })
        : manualQuoteInput && manualQuoteCalculation
          ? await this.pricing.createManualQuote(
              user,
              manualQuoteInput,
              manualQuoteCalculation,
              tx,
            )
          : null;

      if (hasCalculatedQuote && !quote) {
        throw new NotFoundException({
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: 'Price quote not found for this customer',
        });
      }

      const order = await tx.transportOrder.create({
        data: {
          orderCode: this.generateOrderCode(),
          customerId: dto.customerId,
          quoteId: quote?.id ?? null,
          vehicleCategoryId: dto.vehicleCategoryId,
          serviceType: dto.serviceType,
          status: initialStatus,
          scheduleAt: dto.scheduleAt ?? null,
          distanceKm: quote?.distanceKm ?? dto.distanceKm ?? null,
          estimatedDurationMin:
            quote?.estimatedDurationMin ??
            (dto.estimatedDurationMin !== undefined
              ? Math.round(dto.estimatedDurationMin)
              : null),
          totalAmount: quote?.totalAmount ?? null,
          paymentStatus: PAYMENT_STATUS.PENDING,
          notes: dto.notes?.trim() ?? '',
          orderStops: {
            create: dto.stops.map((stop) => ({
              stopType: stop.stopType,
              sequence: stop.sequence,
              contactName: stop.contactName.trim(),
              contactPhone: stop.contactPhone.trim(),
              addressLine: stop.addressLine.trim(),
              city: stop.city.trim(),
              province: stop.province.trim(),
              latitude: stop.latitude ?? null,
              longitude: stop.longitude ?? null,
              instructions: stop.instructions?.trim() ?? null,
            })),
          },
          orderItems: {
            create: dto.items.map((item) => ({
              description: item.description.trim(),
              quantity: item.quantity,
              weightKg: item.weightKg,
              volumeM3: item.volumeM3 ?? null,
              declaredValue: item.declaredValue ?? null,
              fragile: item.fragile ?? false,
              requireHelper: item.requireHelper ?? false,
            })),
          },
          orderEvents: {
            create: {
              eventType: EVENT_TYPE.CREATED,
              actorUserId: user.id,
              description:
                initialStatus === STATUS_ORDERS.DRAFT
                  ? 'Draft order created from TMS'
                  : 'Order created from TMS',
              metadata:
                initialStatus === STATUS_ORDERS.DRAFT
                  ? {
                      source: 'transport-portal',
                      draftReason: 'route_or_quote_not_available',
                    }
                  : { source: 'transport-portal' },
              latitude: null,
              longitude: null,
            },
          },
        },
        include: ORDER_INCLUDE,
      });

      if (dto.serviceType === SERVICE_TYPE.SCHEDULED && dto.scheduleAt) {
        await tx.reservation.create({
          data: {
            orderId: order.id,
            reservedFor: dto.scheduleAt,
            reservationStatus: RESERVATIONS_STATUS.ACTIVE,
            rescheduleCount: 0,
            cancellationDeadline: new Date(
              dto.scheduleAt.getTime() - 60 * 60_000,
            ),
            createdAt: new Date(),
          },
        });
      }

      if (quote && !quote.orderId) {
        await tx.priceQuote.update({
          where: { id: quote.id },
          data: { orderId: order.id },
        });
      }

      return order;
    });

    this.emitOrderCreated(order, user.id);
    if (order.status !== STATUS_ORDERS.DRAFT) {
      void this.notifyOperators('ORDER_CREATED', order).catch(
        (error: unknown) =>
          this.logger.error(
            `Failed to notify operators about new TMS order: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
      );
    }

    return order;
  }

  async createManualQuote(
    user: AuthenticatedUser,
    id: string,
    dto: CreateOrderManualQuoteDto,
  ): Promise<TransportOrder> {
    const current = await this.prisma.transportOrder.findUnique({
      where: { id },
      include: {
        orderStops: true,
        orderItems: true,
      },
    });

    if (!current) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    if (!MANUAL_QUOTE_STATUSES.has(current.status)) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'This order status does not allow manual quote recalculation',
      });
    }

    const manualQuoteInput = this.manualQuoteInputForExistingOrder(
      current,
      dto,
    );
    const calculation = await this.pricing.calculateManualQuote(
      user,
      manualQuoteInput,
    );

    return this.prisma.$transaction(async (tx) => {
      await this.pricing.replaceActiveOrderQuotes(id, tx);
      const quote = await this.pricing.createManualQuote(
        user,
        manualQuoteInput,
        calculation,
        tx,
      );

      await tx.transportOrder.update({
        where: { id },
        data: {
          quoteId: quote.id,
          distanceKm: quote.distanceKm,
          estimatedDurationMin: quote.estimatedDurationMin,
          totalAmount: quote.totalAmount,
          status: this.statusAfterManualQuote(current.status),
        },
        include: ORDER_INCLUDE,
      });

      await tx.orderEvent.create({
        data: {
          orderId: id,
          eventType: EVENT_TYPE.CREATED,
          actorUserId: user.id,
          description: 'Manual provisional quote calculated',
          metadata: {
            quoteId: quote.id,
            quoteSource: quote.quoteSource,
            quoteStatus: quote.quoteStatus,
            totalAmount: Number(quote.totalAmount),
          },
          latitude: null,
          longitude: null,
        },
      });

      return tx.transportOrder.findUniqueOrThrow({
        where: { id },
        include: ORDER_INCLUDE,
      });
    });
  }

  async findAll(
    user: AuthenticatedUser,
    query: OrderQueryDto,
  ): Promise<TransportOrder[]> {
    const where: Prisma.TransportOrderWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.serviceType && { serviceType: query.serviceType }),
      ...(query.customerId && { customerId: query.customerId }),
      ...(query.vehicleCategoryId && {
        vehicleCategoryId: query.vehicleCategoryId,
      }),
      ...(query.driverId && {
        orderAssignments: { some: { driverId: query.driverId } },
      }),
      ...((query.from || query.to) && {
        createdAt: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { orderCode: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        {
          customer: {
            is: {
              OR: [
                { companyName: { contains: search, mode: 'insensitive' } },
                {
                  user: {
                    is: {
                      OR: [
                        { fullName: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
        {
          orderStops: {
            some: {
              OR: [
                { addressLine: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
                { province: { contains: search, mode: 'insensitive' } },
                { contactName: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          orderAssignments: {
            some: {
              driver: {
                is: {
                  user: {
                    is: {
                      fullName: { contains: search, mode: 'insensitive' },
                    },
                  },
                },
              },
            },
          },
        },
      ];
    }

    if (this.isCustomerOnly(user)) {
      const customer = await this.getCustomerProfile(user.id);
      where.customerId = customer.id;
    }

    if (this.isDriverOnly(user)) {
      const driver = await this.prisma.driverProfile.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      if (!driver) {
        return [];
      }

      where.orderAssignments = { some: { driverId: driver.id } };
    }

    return this.prisma.transportOrder.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAvailableForDrivers(
    user: AuthenticatedUser,
  ): Promise<TransportOrder[]> {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
      select: {
        id: true,
        availabilityStatus: true,
        verificationStatus: true,
        licenseExpiration: true,
      },
    });

    if (
      !driver ||
      driver.availabilityStatus !== STATUS_DRIVER.AVAILABLE ||
      driver.verificationStatus !== VERIFICATION_STATUS.APPROVED ||
      driver.licenseExpiration.getTime() <= Date.now()
    ) {
      return [];
    }

    const activeAssignment = await this.prisma.orderAssignment.findFirst({
      where: {
        driverId: driver.id,
        assignmentStatus: { in: ACTIVE_ASSIGNMENT_STATUSES },
        order: { status: { in: ACTIVE_DRIVER_ORDER_STATUSES } },
      },
      select: { id: true },
    });

    if (activeAssignment) {
      return [];
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: { driverId: driver.id, status: STATUS_VEHICLE.ACTIVE },
      select: { categoryId: true },
    });
    const categoryIds = [
      ...new Set(vehicles.map((vehicle) => vehicle.categoryId)),
    ];

    if (categoryIds.length === 0) {
      return [];
    }

    return this.prisma.transportOrder.findMany({
      where: {
        status: STATUS_ORDERS.REQUESTED,
        paymentStatus: { in: DISPATCHABLE_PAYMENT_STATUSES },
        vehicleCategoryId: { in: categoryIds },
        orderAssignments: {
          none: {
            assignmentStatus: {
              in: ACTIVE_ASSIGNMENT_STATUSES,
            },
          },
        },
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  claim(
    user: AuthenticatedUser,
    orderId: string,
    dto: ClaimOrderDto,
  ): Promise<OrderAssignment> {
    return this.assignments.claimOrder(user, orderId, dto.vehicleId);
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<TransportOrder | null> {
    const order = await this.prisma.transportOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });

    if (!order) {
      return null;
    }

    await this.assertCanReadOrder(user, order.customerId);
    await this.assertDriverCanAccessOrder(user, id);

    return order;
  }

  async updateStatus(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateOrderStatusDto,
  ): Promise<TransportOrder> {
    const now = new Date();

    const current = await this.prisma.transportOrder.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    await this.assertDriverCanAccessOrder(user, id);
    this.assertStatusTransition(user, current.status, dto.status);
    if (dto.status === STATUS_ORDERS.DELIVERED) {
      await this.assertDeliveryEvidenceReady(id);
    }

    const order = await this.prisma.$transaction(async (tx) => {
      await tx.transportOrder.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.status === STATUS_ORDERS.IN_PROGRESS && { pickupAt: now }),
          ...(dto.status === STATUS_ORDERS.DELIVERED && { deliveredAt: now }),
        },
        include: ORDER_INCLUDE,
      });

      await tx.orderEvent.create({
        data: {
          orderId: id,
          eventType: this.eventForStatus(dto.status),
          actorUserId: user.id,
          description: `Order status changed to ${dto.status}`,
          metadata: { status: dto.status },
          latitude: null,
          longitude: null,
        },
      });

      if (dto.status === STATUS_ORDERS.DELIVERED) {
        const assignment = await tx.orderAssignment.findFirst({
          where: {
            orderId: id,
            assignmentStatus: {
              in: [ASSIGNMENT_STATUS.PENDING, ASSIGNMENT_STATUS.ACCEPTED],
            },
          },
          orderBy: { assignedAt: 'desc' },
        });

        if (assignment) {
          await tx.orderAssignment.update({
            where: { id: assignment.id },
            data: { assignmentStatus: ASSIGNMENT_STATUS.COMPLETED },
          });
          await tx.driverProfile.update({
            where: { id: assignment.driverId },
            data: { availabilityStatus: STATUS_DRIVER.AVAILABLE },
          });
        }
      }

      return tx.transportOrder.findUniqueOrThrow({
        where: { id },
        include: ORDER_INCLUDE,
      });
    });

    this.realtime.emitOrderStatusChanged({
      orderId: id,
      status: dto.status,
      previousStatus: current.status,
      changedByUserId: user.id,
      changedAt: now.toISOString(),
    });

    void this.notifyOperators('ORDER_STATUS_CHANGED', order, dto.status).catch(
      (error: unknown) =>
        this.logger.error(
          `Failed to notify operators about order status: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
    );

    void this.notifyCustomer(order, dto.status).catch((error: unknown) =>
      this.logger.error(
        `Failed to notify customer about order status: ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );

    return order;
  }

  /**
   * Alias for the driver app: accept the order via the driver's own assignment.
   */
  async accept(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderAssignment> {
    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
    });
    if (!driver) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Driver profile not found',
      });
    }

    const assignment = await this.prisma.orderAssignment.findFirst({
      where: {
        orderId,
        driverId: driver.id,
        assignmentStatus: ASSIGNMENT_STATUS.PENDING,
      },
      orderBy: { assignedAt: 'desc' },
    });
    if (!assignment) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'No pending assignment for this driver on this order',
      });
    }

    return this.assignments.accept(assignment.id, user);
  }

  async confirmByCustomer(
    user: AuthenticatedUser,
    id: string,
  ): Promise<TransportOrder> {
    const customer = await this.getCustomerProfile(user.id);
    const current = await this.prisma.transportOrder.findFirst({
      where: { id, customerId: customer.id },
      select: {
        id: true,
        status: true,
        quoteId: true,
        totalAmount: true,
      },
    });

    if (!current) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found for this customer',
      });
    }

    if (current.status !== STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Only orders pending customer confirmation can be accepted',
      });
    }

    if (current.totalAmount === null || Number(current.totalAmount) <= 0) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Order has no payable amount',
      });
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.transportOrder.update({
        where: { id },
        data: {
          status: STATUS_ORDERS.PENDING_PAYMENT,
          paymentStatus: PAYMENT_STATUS.PENDING,
        },
        include: ORDER_INCLUDE,
      });

      if (current.quoteId) {
        await tx.priceQuote.update({
          where: { id: current.quoteId },
          data: { quoteStatus: QUOTE_STATUS.ACCEPTED },
        });
      }

      await tx.orderEvent.create({
        data: {
          orderId: id,
          eventType: EVENT_TYPE.ACCEPTED,
          actorUserId: user.id,
          description: 'Customer accepted TMS quote; payment is required',
          metadata: {
            previousStatus: current.status,
            status: STATUS_ORDERS.PENDING_PAYMENT,
            paymentProvider: 'pending_selection',
          },
          latitude: null,
          longitude: null,
        },
      });

      return updated;
    });

    this.realtime.emitOrderStatusChanged({
      orderId: id,
      status: STATUS_ORDERS.PENDING_PAYMENT,
      previousStatus: current.status,
      changedByUserId: user.id,
      changedAt: new Date().toISOString(),
    });

    void this.notifyOperators(
      'ORDER_STATUS_CHANGED',
      order,
      STATUS_ORDERS.PENDING_PAYMENT,
    ).catch((error: unknown) =>
      this.logger.error(
        `Failed to notify operators about customer confirmation: ${error instanceof Error ? error.message : 'unknown'}`,
      ),
    );

    return order;
  }

  async cancel(
    user: AuthenticatedUser,
    id: string,
    dto: CancelOrderDto,
  ): Promise<TransportOrder> {
    const current = await this.prisma.transportOrder.findUnique({
      where: { id },
      select: { status: true, paymentStatus: true, customerId: true },
    });

    if (!current) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Order not found',
      });
    }

    await this.assertCanReadOrder(user, current.customerId);

    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.transportOrder.update({
        where: { id },
        data: { status: STATUS_ORDERS.CANCELLED },
        include: ORDER_INCLUDE,
      });

      await tx.orderCancellation.create({
        data: {
          orderId: id,
          cancelledBy: user.id,
          cancellationReason: dto.reason.trim(),
          cancellationType: dto.cancellationType,
          feeApplied: false,
          feeAmount: 0,
          refundAmount: 0,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId: id,
          eventType: EVENT_TYPE.CANCELLED,
          actorUserId: user.id,
          description: dto.reason.trim(),
          metadata: {
            cancellationType: dto.cancellationType,
          },
          latitude: null,
          longitude: 0,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'ORDER_SOFT_DELETED',
          entityType: 'ORDER',
          entityId: id,
          oldValues: {
            status: current.status,
            paymentStatus: current.paymentStatus,
          },
          newValues: {
            status: STATUS_ORDERS.CANCELLED,
            cancellationType: dto.cancellationType,
            reason: dto.reason.trim(),
          },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return order;
    });

    this.realtime.emitOrderStatusChanged({
      orderId: id,
      status: STATUS_ORDERS.CANCELLED,
      changedByUserId: user.id,
      changedAt: new Date().toISOString(),
    });
    void this.notifyOperators('ORDER_CANCELLED', order).catch(
      (error: unknown) =>
        this.logger.error(
          `Failed to notify operators about cancelled order: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
    );

    void this.notifyCustomer(order, STATUS_ORDERS.CANCELLED).catch(
      (error: unknown) =>
        this.logger.error(
          `Failed to notify customer about cancelled order: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
    );

    return order;
  }

  listEvents(orderId: string) {
    return this.prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async assertDeliveryEvidenceReady(orderId: string): Promise<void> {
    const proofs = await this.prisma.deliveryProof.findMany({
      where: { orderId },
      select: { id: true },
    });

    if (proofs.length === 0) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Delivery evidence is required before completing the order',
      });
    }

    const proofIds = proofs.map((proof) => proof.id);
    const [photoAttachment, signature] = await Promise.all([
      this.prisma.attachment.findFirst({
        where: {
          entityType: 'DeliveryProof',
          entityId: { in: proofIds },
          mimeType: { startsWith: 'image/' },
          NOT: { fileName: { contains: 'signature', mode: 'insensitive' } },
        },
        select: { id: true },
      }),
      this.prisma.signature.findFirst({
        where: { proofId: { in: proofIds } },
        select: { id: true },
      }),
    ]);

    if (!photoAttachment || !signature) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message:
          'Delivery photo and recipient signature are required before completing the order',
      });
    }
  }

  private async getCustomerProfile(userId: string) {
    const customer = await this.prisma.customerProfile.findFirst({
      where: { userId },
    });

    if (!customer) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    return customer;
  }

  private async assertCanReadOrder(
    user: AuthenticatedUser,
    customerId: string,
  ): Promise<void> {
    if (!this.isCustomerOnly(user)) {
      return;
    }

    const customer = await this.getCustomerProfile(user.id);

    if (customer.id !== customerId) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You cannot access this order',
      });
    }
  }

  private isCustomerOnly(user: AuthenticatedUser): boolean {
    return (
      user.roles.includes(ROLES.CUSTOMER) &&
      !user.roles.some(
        (role) => role === ROLES.ADMIN || role === ROLES.OPERATOR,
      )
    );
  }

  private isDriverOnly(user: AuthenticatedUser): boolean {
    return (
      user.roles.includes(ROLES.DRIVER) &&
      !user.roles.some(
        (role) => role === ROLES.ADMIN || role === ROLES.OPERATOR,
      )
    );
  }

  /** A driver may only see/act on orders assigned to them. */
  private async assertDriverCanAccessOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<void> {
    if (!this.isDriverOnly(user)) {
      return;
    }

    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
    });
    const assignment = driver
      ? await this.prisma.orderAssignment.findFirst({
          where: { orderId, driverId: driver.id },
        })
      : null;

    if (!assignment) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'This order is not assigned to you',
      });
    }
  }

  private assertStatusTransition(
    user: AuthenticatedUser,
    current: STATUS_ORDERS,
    next: STATUS_ORDERS,
  ): void {
    if (current === next) {
      return;
    }

    if (!STATUS_TRANSITIONS[current]?.includes(next)) {
      throw new DomainException(
        ERROR_CODES.DOMAIN_RULE_VIOLATION,
        `Illegal order status transition: ${current} → ${next}`,
      );
    }

    if (this.isDriverOnly(user) && !DRIVER_TRANSITIONS.has(next)) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: `Drivers cannot set order status to ${next}`,
      });
    }
  }

  private assertVehicleCategoryCapacity(
    dto: { items: { weightKg: number; quantity: number; volumeM3?: number }[] },
    vehicleCategory: { maxWeightKg: unknown; maxVolumenM3: unknown },
  ): void {
    const totalWeightKg = dto.items.reduce(
      (total, item) => total + item.weightKg * item.quantity,
      0,
    );
    const totalVolumeM3 = dto.items.reduce(
      (total, item) => total + (item.volumeM3 ?? 0) * item.quantity,
      0,
    );
    const maxWeightKg = Number(vehicleCategory.maxWeightKg);
    const maxVolumeM3 = Number(vehicleCategory.maxVolumenM3);

    if (Number.isFinite(maxWeightKg) && totalWeightKg > maxWeightKg) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Cargo weight exceeds the selected vehicle category capacity',
      });
    }

    if (Number.isFinite(maxVolumeM3) && totalVolumeM3 > maxVolumeM3) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Cargo volume exceeds the selected vehicle category capacity',
      });
    }
  }

  private eventForStatus(status: STATUS_ORDERS): EVENT_TYPE {
    switch (status) {
      case STATUS_ORDERS.ASSIGNED:
        return EVENT_TYPE.ASSIGNED;
      case STATUS_ORDERS.ACCEPTED:
        return EVENT_TYPE.ACCEPTED;
      case STATUS_ORDERS.IN_PROGRESS:
        return EVENT_TYPE.IN_TRANSIT;
      case STATUS_ORDERS.DELIVERED:
        return EVENT_TYPE.DELIVERED;
      case STATUS_ORDERS.CANCELLED:
        return EVENT_TYPE.CANCELLED;
      default:
        return EVENT_TYPE.CREATED;
    }
  }

  private emitOrderCreated(
    order: TransportOrder,
    createdByUserId: string,
  ): void {
    this.realtime.emitOrderCreated({
      orderId: order.id,
      orderCode: order.orderCode,
      status: order.status,
      serviceType: order.serviceType,
      createdByUserId,
      createdAt: order.createdAt.toISOString(),
    });
  }

  /**
   * Notifies the order's own customer (best-effort).
   *
   * Every status change reached operators and the driver but never the person
   * who requested the trip, so the customer had no way of learning that theirs
   * had been taken, started or delivered.
   */
  private async notifyCustomer(
    order: TransportOrder,
    status: STATUS_ORDERS,
  ): Promise<void> {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: order.customerId },
      select: { userId: true },
    });

    if (!customer) {
      return;
    }

    await this.notifications.dispatch(customer.userId, 'ORDER_STATUS_CHANGED', {
      orderId: order.id,
      orderCode: order.orderCode,
      status: orderStatusLabel(status),
    });
  }

  private async notifyOperators(
    event: NotificationEvent,
    order: TransportOrder,
    status?: string,
  ): Promise<void> {
    const operators = await this.prisma.user.findMany({
      where: {
        userRoles: {
          some: {
            rol: { code: { in: [ROLES.ADMIN, ROLES.OPERATOR] } },
          },
        },
      },
      select: { id: true },
    });

    await Promise.allSettled(
      operators.map((operator) =>
        this.notifications.dispatch(operator.id, event, {
          orderId: order.id,
          orderCode: order.orderCode,
          status,
        }),
      ),
    );
  }

  private generateOrderCode(): string {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();

    return `ORD-${Date.now()}-${suffix}`;
  }

  private addressForQuote(dto: CreateTmsOrderDto, stopType: STOP_TYPE): string {
    const stop =
      dto.stops.find((candidate) => candidate.stopType === stopType) ??
      [...dto.stops].sort((left, right) => left.sequence - right.sequence)[
        stopType === STOP_TYPE.PICKUP ? 0 : dto.stops.length - 1
      ];

    return stop?.addressLine.trim() ?? 'TMS order address';
  }

  private manualQuoteInputForTmsOrder(
    dto: CreateTmsOrderDto,
  ): ManualQuoteInput | null {
    if (!dto.manualQuote) {
      return null;
    }

    return {
      customerId: dto.customerId,
      vehicleCategoryId: dto.vehicleCategoryId,
      originAddress: this.addressForQuote(dto, STOP_TYPE.PICKUP),
      destinationAddress: this.addressForQuote(dto, STOP_TYPE.DROPOFF),
      distanceKm: dto.manualQuote.distanceKm,
      estimatedDurationMin: dto.manualQuote.estimatedDurationMin,
      helperRequired:
        dto.manualQuote.helperRequired ??
        dto.items.some((item) => item.requireHelper === true),
      tollAmount: dto.manualQuote.tollAmount,
      weightSurcharge: dto.manualQuote.weightSurcharge,
      volumeSurcharge: dto.manualQuote.volumeSurcharge,
      otherCharges: dto.manualQuote.otherCharges,
      discountAmount: dto.manualQuote.discountAmount,
      manualAdjustmentAmount: dto.manualQuote.manualAdjustmentAmount,
      adjustmentReason: dto.manualQuote.adjustmentReason,
    };
  }

  private manualQuoteInputForExistingOrder(
    order: OrderWithStopsAndItems,
    dto: CreateOrderManualQuoteDto,
  ): ManualQuoteInput {
    return {
      customerId: order.customerId,
      orderId: order.id,
      vehicleCategoryId: order.vehicleCategoryId,
      originAddress: this.addressForStoredStops(order, STOP_TYPE.PICKUP),
      destinationAddress: this.addressForStoredStops(order, STOP_TYPE.DROPOFF),
      distanceKm: dto.distanceKm,
      estimatedDurationMin: dto.estimatedDurationMin,
      helperRequired:
        dto.helperRequired ??
        order.orderItems.some((item) => item.requireHelper === true),
      tollAmount: dto.tollAmount,
      weightSurcharge: dto.weightSurcharge,
      volumeSurcharge: dto.volumeSurcharge,
      otherCharges: dto.otherCharges,
      discountAmount: dto.discountAmount,
      manualAdjustmentAmount: dto.manualAdjustmentAmount,
      adjustmentReason: dto.adjustmentReason,
    };
  }

  private addressForStoredStops(
    order: OrderWithStopsAndItems,
    stopType: STOP_TYPE,
  ): string {
    const orderedStops = [...order.orderStops].sort(
      (left, right) => left.sequence - right.sequence,
    );
    const stop =
      orderedStops.find((candidate) => candidate.stopType === stopType) ??
      orderedStops[stopType === STOP_TYPE.PICKUP ? 0 : orderedStops.length - 1];

    if (!stop) {
      return 'TMS order address';
    }

    return [stop.addressLine, stop.city, stop.province]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
  }

  private statusAfterManualQuote(current: STATUS_ORDERS): STATUS_ORDERS {
    if (current === STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION) {
      return current;
    }

    return STATUS_ORDERS.PENDING_CUSTOMER_CONFIRMATION;
  }
}
