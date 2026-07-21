import { Injectable } from '@nestjs/common';
import type { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { ReportQueryDto } from './dto/report-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async operations(query: ReportQueryDto) {
    const orderWhere = dateRange('createdAt', query);
    const assignmentWhere = dateRange('assignedAt', query);
    const incidentWhere = dateRange('reportedAt', query);
    const proofWhere = dateRange('capturedAt', query);

    const [orders, assignments, incidents, proofs] =
      await this.prisma.$transaction([
        this.prisma.transportOrder.groupBy({
          by: ['status'],
          where: orderWhere,
          orderBy: { status: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.orderAssignment.groupBy({
          by: ['assignmentStatus'],
          where: assignmentWhere,
          orderBy: { assignmentStatus: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.incident.groupBy({
          by: ['status'],
          where: incidentWhere,
          orderBy: { status: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.deliveryProof.groupBy({
          by: ['validationStatus'],
          where: proofWhere,
          orderBy: { validationStatus: 'asc' },
          _count: { _all: true },
        }),
      ]);

    return { orders, assignments, incidents, proofs };
  }

  async billing(query: ReportQueryDto) {
    const paymentWhere = dateRange('createdAt', query);
    const refundWhere = dateRange('createdAt', query);

    const [payments, refunds] = await this.prisma.$transaction([
      this.prisma.payment.groupBy({
        by: ['status'],
        where: paymentWhere,
        orderBy: { status: 'asc' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.refund.groupBy({
        by: ['status'],
        where: refundWhere,
        orderBy: { status: 'asc' },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    return { payments, refunds };
  }
}

function dateRange<T extends string>(
  field: T,
  query: ReportQueryDto,
): Record<T, Prisma.DateTimeFilter> | undefined {
  if (!query.from && !query.to) {
    return undefined;
  }

  return {
    [field]: {
      ...(query.from && { gte: query.from }),
      ...(query.to && { lte: query.to }),
    },
  } as Record<T, Prisma.DateTimeFilter>;
}
