import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, TransportOrder } from '@generated/prisma/client';
import {
  EVENT_TYPE,
  PAYMENT_STATUS,
  ROLES,
  SERVICE_TYPE,
  STATUS_ORDERS,
} from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CancelOrderDto } from './dto/cancel-order.dto';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { OrderQueryDto } from './dto/order-query.dto';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto';

const ORDER_INCLUDE = {
  orderStops: true,
  orderItems: true,
  orderAssignments: true,
  orderEvents: { orderBy: { createdAt: 'asc' as const } },
  reservations: true,
  payments: true,
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateOrderDto,
  ): Promise<TransportOrder> {
    const customer = await this.getCustomerProfile(user.id);
    const quote = await this.prisma.priceQuote.findFirst({
      where: { id: dto.quoteId, customerId: customer.id },
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

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.transportOrder.create({
        data: {
          orderCode: this.generateOrderCode(),
          customerId: customer.id,
          quoteId: quote.id,
          vehicleCategoryId: quote.vehicleCategoryId,
          serviceType: dto.serviceType,
          status: STATUS_ORDERS.REQUESTED,
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
              latitude: stop.latitude,
              longitude: stop.longitude,
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
  }

  async findAll(
    user: AuthenticatedUser,
    query: OrderQueryDto,
  ): Promise<TransportOrder[]> {
    const where: Prisma.TransportOrderWhereInput = {
      ...(query.status && { status: query.status }),
    };

    if (this.isCustomerOnly(user)) {
      const customer = await this.getCustomerProfile(user.id);
      where.customerId = customer.id;
    }

    return this.prisma.transportOrder.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
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

    return order;
  }

  async updateStatus(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateOrderStatusDto,
  ): Promise<TransportOrder> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.transportOrder.update({
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
          longitude: 0,
        },
      });

      return order;
    });
  }

  async cancel(
    user: AuthenticatedUser,
    id: string,
    dto: CancelOrderDto,
  ): Promise<TransportOrder> {
    return this.prisma.$transaction(async (tx) => {
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

      return order;
    });
  }

  listEvents(orderId: string) {
    return this.prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
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

  private generateOrderCode(): string {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();

    return `ORD-${Date.now()}-${suffix}`;
  }
}
