import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async operations() {
    const [orders, assignments, incidents, proofs] =
      await this.prisma.$transaction([
        this.prisma.transportOrder.groupBy({
          by: ['status'],
          orderBy: { status: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.orderAssignment.groupBy({
          by: ['assignmentStatus'],
          orderBy: { assignmentStatus: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.incident.groupBy({
          by: ['status'],
          orderBy: { status: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.deliveryProof.groupBy({
          by: ['validationStatus'],
          orderBy: { validationStatus: 'asc' },
          _count: { _all: true },
        }),
      ]);

    return { orders, assignments, incidents, proofs };
  }

  async billing() {
    const [payments, refunds] = await this.prisma.$transaction([
      this.prisma.payment.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.refund.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    return { payments, refunds };
  }
}
