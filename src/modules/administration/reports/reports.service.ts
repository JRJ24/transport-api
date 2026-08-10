import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { ReportQueryDto } from './dto/report-query.dto';

type ReportType = 'operations' | 'billing';
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

  async export(
    type: ReportType,
    format: ReportFormat,
    query: ReportQueryDto,
  ): Promise<ExportedReport> {
    if (type !== 'operations' && type !== 'billing') {
      throw new BadRequestException('Unsupported report type');
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
