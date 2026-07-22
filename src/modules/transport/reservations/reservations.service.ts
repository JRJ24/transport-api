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

  reschedule(id: string, dto: RescheduleReservationDto): Promise<Reservation> {
    return this.prisma.reservation.update({
      where: { id },
      data: {
        reservedFor: dto.reservedFor,
        reservationStatus: RESERVATIONS_STATUS.RESCHUDULED,
        cancellationDeadline: this.cancellationDeadline(dto.reservedFor),
        rescheduleCount: { increment: 1 },
      },
    });
  }

  cancel(id: string): Promise<Reservation> {
    return this.prisma.reservation.update({
      where: { id },
      data: { reservationStatus: RESERVATIONS_STATUS.CANCELLED },
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
