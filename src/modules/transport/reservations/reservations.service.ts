import { Injectable } from '@nestjs/common';
import type { Prisma, Reservation } from '@generated/prisma/client';
import { RESERVATIONS_STATUS } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import type { CreateReservationDto } from './dto/create-reservation.dto';
import type { ReservationQueryDto } from './dto/reservation-query.dto';
import type { RescheduleReservationDto } from './dto/reschedule-reservation.dto';

const SAFE_USER_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ReservationQueryDto): Promise<Reservation[]> {
    const where: Prisma.ReservationWhereInput = {
      ...(query.orderId && { orderId: query.orderId }),
      ...(query.status && { reservationStatus: query.status }),
      ...((query.from || query.to) && {
        reservedFor: {
          ...(query.from && { gte: query.from }),
          ...(query.to && { lte: query.to }),
        },
      }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.order = {
        is: {
          OR: [
            { orderCode: { contains: search, mode: 'insensitive' } },
            {
              customer: {
                is: {
                  OR: [
                    { companyName: { contains: search, mode: 'insensitive' } },
                    {
                      user: {
                        is: {
                          fullName: { contains: search, mode: 'insensitive' },
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      };
    }

    return this.prisma.reservation.findMany({
      where,
      include: {
        order: {
          include: {
            customer: { include: { user: { select: SAFE_USER_SELECT } } },
            vehicleCategory: true,
          },
        },
      },
      orderBy: { reservedFor: 'asc' },
    });
  }

  create(dto: CreateReservationDto): Promise<Reservation> {
    return this.prisma.reservation.create({
      data: {
        orderId: dto.orderId,
        reservedFor: dto.reservedFor,
        reservationStatus: RESERVATIONS_STATUS.ACTIVE,
        rescheduleCount: 0,
        cancellationDeadline: this.cancellationDeadline(dto.reservedFor),
        createdAt: new Date(),
      },
    });
  }

  reschedule(
    id: string,
    dto: RescheduleReservationDto,
    actorUserId: string,
  ): Promise<Reservation> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.reservation.findUnique({ where: { id } });
      const reservation = await tx.reservation.update({
        where: { id },
        data: {
          reservedFor: dto.reservedFor,
          reservationStatus: RESERVATIONS_STATUS.RESCHUDULED,
          cancellationDeadline: this.cancellationDeadline(dto.reservedFor),
          rescheduleCount: { increment: 1 },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'RESERVATION_RESCHEDULED',
          entityType: 'RESERVATION',
          entityId: id,
          ...(existing && {
            oldValues: {
              reservedFor: existing.reservedFor.toISOString(),
              reservationStatus: existing.reservationStatus,
            },
          }),
          newValues: {
            reservedFor: reservation.reservedFor.toISOString(),
            reservationStatus: reservation.reservationStatus,
          },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return reservation;
    });
  }

  cancel(id: string, actorUserId: string): Promise<Reservation> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.reservation.findUnique({ where: { id } });
      const reservation = await tx.reservation.update({
        where: { id },
        data: { reservationStatus: RESERVATIONS_STATUS.CANCELLED },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'RESERVATION_SOFT_DELETED',
          entityType: 'RESERVATION',
          entityId: id,
          ...(existing && {
            oldValues: { reservationStatus: existing.reservationStatus },
          }),
          newValues: { reservationStatus: reservation.reservationStatus },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      });

      return reservation;
    });
  }

  complete(id: string): Promise<Reservation> {
    return this.prisma.reservation.update({
      where: { id },
      data: { reservationStatus: RESERVATIONS_STATUS.COMPLETED },
    });
  }

  private cancellationDeadline(reservedFor: Date): Date {
    return new Date(reservedFor.getTime() - 60 * 60_000);
  }
}
