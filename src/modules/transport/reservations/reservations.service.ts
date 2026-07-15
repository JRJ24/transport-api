import { Injectable } from '@nestjs/common';
import type { Reservation } from '@generated/prisma/client';
import { RESERVATIONS_STATUS } from '@generated/prisma/enums';
import { PrismaService } from '@/database/prisma.service';
import type { CreateReservationDto } from './dto/create-reservation.dto';
import type { RescheduleReservationDto } from './dto/reschedule-reservation.dto';

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Reservation[]> {
    return this.prisma.reservation.findMany({
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
