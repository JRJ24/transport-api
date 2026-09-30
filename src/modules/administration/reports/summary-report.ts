import { Workbook } from 'exceljs';
import PDFDocument from 'pdfkit';

/** Payments that count as money in: confirmed or authorized (check, credit). */
export const REVENUE_PAYMENT_STATUSES = ['PAID', 'AUTHORIZED'] as const;
/** Grace on top of the estimated duration before a delivery counts as late. */
export const ON_TIME_GRACE_MIN = 15;

export interface SummaryReport {
  range: { from: string; to: string; days: number };
  orders: {
    total: number;
    delivered: number;
    cancelled: number;
    failed: number;
    inProgress: number;
    byStatus: { status: string; count: number }[];
    cancellationRate: number | null;
  };
  revenue: {
    total: number;
    payments: number;
    averageTicket: number | null;
    byMethod: { method: string; amount: number; count: number }[];
    refunded: number;
  };
  onTime: { measured: number; onTime: number; rate: number | null };
  daily: { date: string; orders: number; delivered: number; revenue: number }[];
  topDrivers: { driverId: string; name: string; trips: number }[];
  offers: {
    made: number;
    accepted: number;
    rejected: number;
    expired: number;
    acceptanceRate: number | null;
  };
}

const pct = (value: number | null) =>
  value === null ? '—' : `${(value * 100).toFixed(1)} %`;
const money = (value: number) =>
  new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' }).format(
    value,
  );

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING_QUOTE: 'Pendiente de cotización',
  PENDING_CUSTOMER_CONFIRMATION: 'Esperando confirmación',
  PENDING_PAYMENT: 'Pendiente de pago',
  CONFIRMED: 'Confirmada',
  REQUESTED: 'Pagada sin conductor',
  ASSIGNING_DRIVER: 'Ofreciendo a conductor',
  ASSIGNED: 'Asignada',
  ACCEPTED: 'Conductor confirmado',
  IN_PROGRESS: 'En camino',
  DELIVERED: 'Entregada',
  CANCELLED: 'Cancelada',
  FAILED: 'Fallida',
};
const METHOD_LABELS: Record<string, string> = {
  CARD: 'Tarjeta',
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  WALLET: 'Billetera',
  CHECK: 'Cheque',
  CORPORATE_CREDIT: 'Crédito corporativo',
};

/** Rows of each section, shared by the Excel and PDF exports. */
function sections(report: SummaryReport) {
  return [
    {
      title: 'Indicadores',
      columns: ['Indicador', 'Valor', 'Definición'],
      rows: [
        [
          'Ingresos',
          money(report.revenue.total),
          'Pagos confirmados o autorizados',
        ],
        ['Órdenes', String(report.orders.total), 'Creadas en el periodo'],
        ['Entregadas', String(report.orders.delivered), ''],
        [
          'Ticket promedio',
          report.revenue.averageTicket === null
            ? '—'
            : money(report.revenue.averageTicket),
          'Ingresos / pagos confirmados',
        ],
        [
          'Tasa de cancelación',
          pct(report.orders.cancellationRate),
          'Canceladas / órdenes',
        ],
        [
          'Entregas a tiempo',
          pct(report.onTime.rate),
          `Entrega ≤ recogida + duración estimada + ${ON_TIME_GRACE_MIN} min (${report.onTime.measured} medibles)`,
        ],
        [
          'Aceptación de ofertas',
          pct(report.offers.acceptanceRate),
          'Ofertas automáticas aceptadas / respondidas',
        ],
        ['Reembolsos', money(report.revenue.refunded), ''],
      ],
    },
    {
      title: 'Órdenes por estado',
      columns: ['Estado', 'Órdenes', '%'],
      rows: report.orders.byStatus.map((row) => [
        STATUS_LABELS[row.status] ?? row.status,
        String(row.count),
        report.orders.total
          ? `${((row.count / report.orders.total) * 100).toFixed(1)} %`
          : '—',
      ]),
    },
    {
      title: 'Ingresos por método de pago',
      columns: ['Método', 'Pagos', 'Monto'],
      rows: report.revenue.byMethod.map((row) => [
        METHOD_LABELS[row.method] ?? row.method,
        String(row.count),
        money(row.amount),
      ]),
    },
    {
      title: 'Serie diaria',
      columns: ['Fecha', 'Órdenes', 'Entregadas', 'Ingresos'],
      rows: report.daily.map((row) => [
        row.date,
        String(row.orders),
        String(row.delivered),
        money(row.revenue),
      ]),
    },
    {
      title: 'Conductores con más viajes',
      columns: ['Conductor', 'Viajes completados'],
      rows: report.topDrivers.map((row) => [row.name, String(row.trips)]),
    },
  ];
}

export async function summaryToXlsx(report: SummaryReport): Promise<Buffer> {
  const workbook = new Workbook();
  workbook.creator = 'RUTA RD';
  workbook.created = new Date();
  for (const section of sections(report)) {
    const sheet = workbook.addWorksheet(section.title.slice(0, 31));
    sheet.addRow([
      `${section.title} · ${report.range.from.slice(0, 10)} a ${report.range.to.slice(0, 10)}`,
    ]).font = { bold: true, size: 13 };
    sheet.addRow([]);
    const header = sheet.addRow(section.columns);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1D4ED8' },
      };
    });
    section.rows.forEach((row) => sheet.addRow(row));
    sheet.columns.forEach((column) => {
      column.width = 24;
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function summaryToPdf(report: SummaryReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#0f172a').text('RUTA RD · Reporte operativo');
    doc
      .moveDown(0.3)
      .fontSize(10)
      .fillColor('#64748b')
      .text(
        `Periodo: ${report.range.from.slice(0, 10)} a ${report.range.to.slice(0, 10)} · Generado ${new Date().toLocaleString('es-DO')}`,
      );

    for (const section of sections(report)) {
      if (doc.y > 650) doc.addPage();
      doc.moveDown(1.2).fontSize(13).fillColor('#1d4ed8').text(section.title);
      doc.moveDown(0.4);
      const width = (doc.page.width - 96) / section.columns.length;
      const drawRow = (cells: string[], bold = false) => {
        if (doc.y > doc.page.height - 72) doc.addPage();
        const y = doc.y;
        cells.forEach((cell, index) => {
          doc
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(9)
            .fillColor(bold ? '#0f172a' : '#334155')
            .text(cell, 48 + index * width, y, { width: width - 8 });
        });
        doc.moveDown(0.5);
      };
      drawRow(section.columns, true);
      if (!section.rows.length) drawRow(['Sin datos en el periodo']);
      section.rows.forEach((row) => drawRow(row));
    }
    doc.end();
  });
}

export function summaryToCsv(report: SummaryReport): string {
  const cell = (value: string) =>
    /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines: string[] = [];
  for (const section of sections(report)) {
    lines.push(cell(section.title));
    lines.push(section.columns.map(cell).join(','));
    section.rows.forEach((row) => lines.push(row.map(cell).join(',')));
    lines.push('');
  }
  return `\uFEFF${lines.join('\n')}`;
}
