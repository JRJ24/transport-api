import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { ReportQueryDto } from './dto/report-query.dto';
import {
  ON_TIME_GRACE_MIN,
  REVENUE_PAYMENT_STATUSES,
  summaryToCsv,
  summaryToPdf,
  summaryToXlsx,
  type SummaryReport,
} from './summary-report';

type ReportType = 'operations' | 'billing' | 'summary';
/** Dominican Republic is UTC-4 all year. */
const DR_TIME_ZONE = 'America/Santo_Domingo';
type ReportFormat = 'csv' | 'xlsx' | 'pdf';

interface ExportedReport {
  content: Buffer;
  contentType: string;
  filename: string;
}

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
        by: ['status', 'paymentMethod'],
        where: paymentWhere,
        orderBy: [{ status: 'asc' }, { paymentMethod: 'asc' }],
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

  /**
   * The management report with honest figures: revenue only counts payments
   * that were confirmed or authorized, on-time is measured against the
   * estimated trip duration, and every count is a count (not a percentage).
   */
  async summary(query: ReportQueryDto): Promise<SummaryReport> {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60_000);
    const created = { gte: from, lte: to };

    const [byStatus, payments, refunds, delivered, trips, offers] =
      await Promise.all([
        this.prisma.transportOrder.groupBy({
          by: ['status'],
          where: { createdAt: created },
          _count: { _all: true },
        }),
        this.prisma.payment.groupBy({
          by: ['paymentMethod'],
          where: {
            createdAt: created,
            status: { in: [...REVENUE_PAYMENT_STATUSES] },
          },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        this.prisma.refund.aggregate({
          where: { createdAt: created },
          _sum: { amount: true },
        }),
        this.prisma.transportOrder.findMany({
          where: {
            createdAt: created,
            status: 'DELIVERED',
            pickupAt: { not: null },
            deliveredAt: { not: null },
            estimatedDurationMin: { not: null },
          },
          select: {
            pickupAt: true,
            deliveredAt: true,
            estimatedDurationMin: true,
          },
        }),
        this.prisma.orderAssignment.groupBy({
          by: ['driverId'],
          where: { assignedAt: created, assignmentStatus: 'COMPLETED' },
          _count: { _all: true },
          orderBy: { _count: { driverId: 'desc' } },
          take: 5,
        }),
        this.prisma.driverOffer.groupBy({
          by: ['status'],
          where: { createdAt: created, mode: 'AUTO' },
          _count: { _all: true },
        }),
      ]);

    const count = (status: string) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const revenue = payments.reduce(
      (sum, row) => sum + Number(row._sum.amount ?? 0),
      0,
    );
    const paymentCount = payments.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );

    const onTime = delivered.filter(
      (order) =>
        order.deliveredAt!.getTime() <=
        order.pickupAt!.getTime() +
          (order.estimatedDurationMin! + ON_TIME_GRACE_MIN) * 60_000,
    ).length;

    const drivers = trips.length
      ? await this.prisma.driverProfile.findMany({
          where: { id: { in: trips.map((row) => row.driverId) } },
          select: { id: true, user: { select: { fullName: true } } },
        })
      : [];

    const offerCount = (status: string) =>
      offers.find((row) => row.status === status)?._count._all ?? 0;
    const answered =
      offerCount('ACCEPTED') + offerCount('REJECTED') + offerCount('EXPIRED');

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        days: Math.max(
          1,
          Math.round((to.getTime() - from.getTime()) / 86_400_000),
        ),
      },
      orders: {
        total,
        delivered: count('DELIVERED'),
        cancelled: count('CANCELLED'),
        failed: count('FAILED'),
        inProgress:
          count('IN_PROGRESS') + count('ACCEPTED') + count('ASSIGNED'),
        byStatus: byStatus
          .map((row) => ({ status: row.status, count: row._count._all }))
          .sort((a, b) => b.count - a.count),
        cancellationRate: total ? count('CANCELLED') / total : null,
      },
      revenue: {
        total: Math.round(revenue * 100) / 100,
        payments: paymentCount,
        averageTicket: paymentCount
          ? Math.round((revenue / paymentCount) * 100) / 100
          : null,
        byMethod: payments
          .map((row) => ({
            method: row.paymentMethod,
            amount: Math.round(Number(row._sum.amount ?? 0) * 100) / 100,
            count: row._count._all,
          }))
          .sort((a, b) => b.amount - a.amount),
        refunded: Math.round(Number(refunds._sum.amount ?? 0) * 100) / 100,
      },
      onTime: {
        measured: delivered.length,
        onTime,
        rate: delivered.length ? onTime / delivered.length : null,
      },
      daily: await this.daily(from, to),
      topDrivers: trips.map((row) => ({
        driverId: row.driverId,
        name:
          drivers.find((driver) => driver.id === row.driverId)?.user
            ?.fullName ?? 'Conductor',
        trips: row._count._all,
      })),
      offers: {
        made: offers.reduce((sum, row) => sum + row._count._all, 0),
        accepted: offerCount('ACCEPTED'),
        rejected: offerCount('REJECTED'),
        expired: offerCount('EXPIRED'),
        acceptanceRate: answered ? offerCount('ACCEPTED') / answered : null,
      },
    };
  }

  /** Orders, deliveries and confirmed revenue per day, in DR time. */
  private async daily(from: Date, to: Date): Promise<SummaryReport['daily']> {
    const [orders, revenue] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; orders: bigint; delivered: bigint }[]>`
        SELECT date_trunc('day', "created_at" AT TIME ZONE 'UTC' AT TIME ZONE ${DR_TIME_ZONE}) AS day,
               COUNT(*) AS orders,
               COUNT(*) FILTER (WHERE "status" = 'DELIVERED') AS delivered
        FROM "ORDERS"."TransportOrders"
        WHERE "created_at" BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ day: Date; revenue: unknown }[]>`
        SELECT date_trunc('day', "created_at" AT TIME ZONE 'UTC' AT TIME ZONE ${DR_TIME_ZONE}) AS day,
               COALESCE(SUM("amount"), 0) AS revenue
        FROM "PAIDS"."payments"
        WHERE "created_at" BETWEEN ${from} AND ${to}
          AND "status"::text IN ('PAID', 'AUTHORIZED')
        GROUP BY 1 ORDER BY 1`,
    ]);

    const key = (value: Date) => new Date(value).toISOString().slice(0, 10);
    const byDay = new Map<
      string,
      { orders: number; delivered: number; revenue: number }
    >();
    for (const row of orders) {
      byDay.set(key(row.day), {
        orders: Number(row.orders),
        delivered: Number(row.delivered),
        revenue: 0,
      });
    }
    for (const row of revenue) {
      const entry = byDay.get(key(row.day)) ?? {
        orders: 0,
        delivered: 0,
        revenue: 0,
      };
      entry.revenue = Math.round(Number(row.revenue) * 100) / 100;
      byDay.set(key(row.day), entry);
    }

    // Every day of the range, zeros included, so charts do not skip days.
    const days: SummaryReport['daily'] = [];
    const cursor = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
    while (cursor <= to && days.length < 400) {
      const date = cursor.toISOString().slice(0, 10);
      days.push({
        date,
        ...(byDay.get(date) ?? { orders: 0, delivered: 0, revenue: 0 }),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  async export(
    type: ReportType,
    format: ReportFormat,
    query: ReportQueryDto,
  ): Promise<ExportedReport> {
    if (type !== 'operations' && type !== 'billing' && type !== 'summary') {
      throw new BadRequestException('Unsupported report type');
    }

    if (type === 'summary') {
      const report = await this.summary(query);
      const baseName = `reporte-ruta-rd-${report.range.from.slice(0, 10)}-a-${report.range.to.slice(0, 10)}`;
      if (format === 'xlsx') {
        return {
          content: await summaryToXlsx(report),
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: `${baseName}.xlsx`,
        };
      }
      if (format === 'pdf') {
        return {
          content: await summaryToPdf(report),
          contentType: 'application/pdf',
          filename: `${baseName}.pdf`,
        };
      }
      return {
        content: Buffer.from(summaryToCsv(report), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        filename: `${baseName}.csv`,
      };
    }

    const data =
      type === 'operations'
        ? await this.operations(query)
        : await this.billing(query);
    const rows = flattenReport(data);
    const title =
      type === 'operations'
        ? 'Reporte de operaciones'
        : 'Reporte de facturacion';
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `${type}-${stamp}`;

    if (format === 'csv') {
      return {
        content: Buffer.from(toCsv(rows), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        filename: `${baseName}.csv`,
      };
    }

    if (format === 'xlsx') {
      return {
        content: Buffer.from(toExcelHtml(title, rows), 'utf8'),
        contentType: 'application/vnd.ms-excel; charset=utf-8',
        filename: `${baseName}.xls`,
      };
    }

    return {
      content: toPdf(title, rows),
      contentType: 'application/pdf',
      filename: `${baseName}.pdf`,
    };
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

function flattenReport(
  data: Record<string, unknown>,
): Record<string, string>[] {
  const rows: Record<string, string>[] = [];

  for (const [section, value] of Object.entries(data)) {
    if (!Array.isArray(value)) {
      continue;
    }

    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      rows.push({ section, ...flattenGroup(item as Record<string, unknown>) });
    }
  }

  return rows.length
    ? rows
    : [{ section: 'sin-datos', estado: 'sin registros' }];
}

function flattenGroup(group: Record<string, unknown>): Record<string, string> {
  const row: Record<string, string> = {};

  for (const [key, value] of Object.entries(group)) {
    if (key === '_count' && isRecord(value)) {
      row.count = toText(value._all ?? 0);
      continue;
    }

    if (key === '_sum' && isRecord(value)) {
      for (const [sumKey, sumValue] of Object.entries(value)) {
        row[`sum_${sumKey}`] = toText(sumValue ?? 0);
      }
      continue;
    }

    row[key] = toText(value ?? '');
  }

  return row;
}

function toCsv(rows: Record<string, string>[]): string {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [headers.join(',')];

  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header] ?? '')).join(','));
  }

  return `${lines.join('\n')}\n`;
}

function toExcelHtml(title: string, rows: Record<string, string>[]): string {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const head = headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] ?? '')}</td>`).join('')}</tr>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8" /></head><body><h1>${escapeHtml(title)}</h1><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function toPdf(title: string, rows: Record<string, string>[]): Buffer {
  const lines = [
    title,
    `Generado: ${new Date().toISOString()}`,
    ...rows.slice(0, 40).map((row) =>
      Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' | '),
    ),
  ];
  const text = lines
    .map((line) => `(${escapePdf(line.slice(0, 120))}) Tj T*`)
    .join('\n');
  const stream = `BT /F1 9 Tf 40 780 Td 12 TL\n${text}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapePdf(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return JSON.stringify(value);
}
