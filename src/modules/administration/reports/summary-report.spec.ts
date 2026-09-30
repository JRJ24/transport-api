import {
  summaryToCsv,
  summaryToPdf,
  summaryToXlsx,
  type SummaryReport,
} from './summary-report';

const report: SummaryReport = {
  range: {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-30T23:59:59.000Z',
    days: 30,
  },
  orders: {
    total: 10,
    delivered: 7,
    cancelled: 1,
    failed: 0,
    inProgress: 2,
    byStatus: [
      { status: 'DELIVERED', count: 7 },
      { status: 'CANCELLED', count: 1 },
    ],
    cancellationRate: 0.1,
  },
  revenue: {
    total: 18884.84,
    payments: 8,
    averageTicket: 2360.61,
    byMethod: [{ method: 'CORPORATE_CREDIT', amount: 18884.84, count: 8 }],
    refunded: 0,
  },
  onTime: { measured: 5, onTime: 4, rate: 0.8 },
  daily: [{ date: '2026-09-29', orders: 3, delivered: 2, revenue: 3029.3 }],
  topDrivers: [{ driverId: 'd1', name: 'Juan Pérez', trips: 7 }],
  offers: {
    made: 4,
    accepted: 3,
    rejected: 1,
    expired: 0,
    acceptanceRate: 0.75,
  },
};

describe('summary report exports', () => {
  it('builds a real xlsx workbook (zip signature)', async () => {
    const buffer = await summaryToXlsx(report);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('builds a real pdf', async () => {
    const buffer = await summaryToPdf(report);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('writes Spanish labels, not enum codes, in the csv', () => {
    const csv = summaryToCsv(report);
    expect(csv).toContain('Entregada');
    expect(csv).toContain('Crédito corporativo');
    expect(csv).not.toContain('CORPORATE_CREDIT');
    expect(csv).toContain('Pagos confirmados o autorizados');
  });
});
