import type { RateRule } from '@generated/prisma/client';
import { PricingService, priceFor } from './pricing.service';
import type { PrismaService } from '@/database/prisma.service';

function rule(overrides: Partial<Record<keyof RateRule, unknown>> = {}) {
  return {
    id: 'rule-1',
    rateCardId: 'card-1',
    vehicleCategoryId: 'cat-moto',
    baseFare: 60,
    pricePerKM: 18,
    pricePerMinute: 2,
    minimumFare: 150,
    helperFee: 200,
    nightFee: 100,
    waitingPricePerMinute: 3,
    cancellationFee: 50,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  } as unknown as RateRule;
}

function category(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-moto',
    code: 'MOTO',
    name: 'RUTA Moto',
    description: '',
    baseCapacityNote: 'Paquetes y documentos',
    maxWeightKg: 50,
    maxVolumenM3: 0.5,
    isActive: true,
    ...overrides,
  };
}

function makeService(data: {
  categories?: Record<string, unknown>[];
  rules?: RateRule[];
}) {
  const priceQuoteCreate = jest.fn();
  const prisma = {
    vehicleCategory: {
      findMany: jest.fn().mockResolvedValue(data.categories ?? []),
    },
    rateRule: {
      findMany: jest.fn().mockResolvedValue(data.rules ?? []),
      findFirst: jest.fn().mockResolvedValue(data.rules?.[0] ?? null),
    },
    priceQuote: { create: priceQuoteCreate },
    customerProfile: { findFirst: jest.fn() },
  } as unknown as PrismaService;

  return { service: new PricingService(prisma), prisma, priceQuoteCreate };
}

const route = { distanceKm: 13.2, estimatedDurationMin: 28 };

describe('PricingService.quoteOptions', () => {
  it('prices every active category and keeps the catalog order', async () => {
    const { service } = makeService({
      categories: [
        category(),
        category({
          id: 'cat-cargo',
          code: 'CARGO',
          name: 'RUTA Cargo',
          maxWeightKg: 1500,
          maxVolumenM3: 8,
        }),
      ],
      rules: [
        rule(),
        rule({
          id: 'rule-2',
          vehicleCategoryId: 'cat-cargo',
          baseFare: 400,
          pricePerKM: 45,
        }),
      ],
    });

    const options = await service.quoteOptions(route);

    expect(options.map((option) => option.code)).toEqual(['MOTO', 'CARGO']);
    expect(options[0].totalAmount).toBeGreaterThan(0);
    expect(options[1].totalAmount).toBeGreaterThan(options[0].totalAmount!);
    expect(options.every((option) => option.fits)).toBe(true);
  });

  // The whole point of asking for the load before showing the cards: a
  // category that cannot take it must never be offered at a price.
  it('marks a category the load does not fit as unavailable', async () => {
    const { service } = makeService({
      categories: [
        category(),
        category({
          id: 'cat-cargo',
          code: 'CARGO',
          maxWeightKg: 1500,
          maxVolumenM3: 8,
        }),
      ],
      rules: [rule(), rule({ id: 'rule-2', vehicleCategoryId: 'cat-cargo' })],
    });

    const [moto, cargo] = await service.quoteOptions({
      ...route,
      weightKg: 120,
    });

    expect(moto.fits).toBe(false);
    expect(moto.unavailable).toBe('CAPACITY');
    expect(cargo.fits).toBe(true);
  });

  it('multiplies the declared weight by the quantity', async () => {
    const { service } = makeService({
      categories: [category()],
      rules: [rule()],
    });

    const [fitting] = await service.quoteOptions({
      ...route,
      weightKg: 20,
      quantity: 2,
    });
    const [overloaded] = await service.quoteOptions({
      ...route,
      weightKg: 20,
      quantity: 3,
    });

    expect(fitting.fits).toBe(true);
    expect(overloaded.fits).toBe(false);
  });

  it('reports a category with no active rate rule instead of hiding it', async () => {
    const { service } = makeService({ categories: [category()], rules: [] });

    const [option] = await service.quoteOptions(route);

    expect(option.totalAmount).toBeNull();
    expect(option.unavailable).toBe('NO_RATE');
    expect(option.fits).toBe(false);
  });

  it('never writes a PriceQuote row', async () => {
    const { service, priceQuoteCreate } = makeService({
      categories: [category()],
      rules: [rule()],
    });

    await service.quoteOptions(route);

    expect(priceQuoteCreate).not.toHaveBeenCalled();
  });

  it('queries the rate rules once for every category, not once each', async () => {
    const { service, prisma } = makeService({
      categories: [category(), category({ id: 'b' }), category({ id: 'c' })],
      rules: [rule()],
    });

    await service.quoteOptions(route);

    expect(prisma.rateRule.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('the card price and the charged price', () => {
  // The reason `priceFor` was extracted. If these two ever diverge, a customer
  // is quoted one number on the card and charged another on the order.
  it('persists exactly what quoteOptions showed for the chosen category', async () => {
    const { service, prisma, priceQuoteCreate } = makeService({
      categories: [category()],
      rules: [rule()],
    });
    (prisma.customerProfile.findFirst as jest.Mock).mockResolvedValue({
      id: 'customer-1',
    });
    priceQuoteCreate.mockImplementation(({ data }: { data: unknown }) => data);

    const [option] = await service.quoteOptions({
      ...route,
      requireHelper: true,
    });

    const saved = (await service.createQuote(
      { id: 'user-1' } as never,
      {
        vehicleCategoryId: 'cat-moto',
        originAddress: 'Av. Sarasota 12',
        destinationAddress: 'Av. Lincoln 40',
        ...route,
        requireHelper: true,
      } as never,
    )) as unknown as { totalAmount: number };

    expect(saved.totalAmount).toBe(option.totalAmount);
  });
});

describe('priceFor', () => {
  // This is the guarantee the card list rests on: the number the customer sees
  // is computed by the same function that prices the saved quote.
  it('is the single source of the fare, extras included', () => {
    const plain = priceFor(rule(), route);
    const withHelper = priceFor(rule(), { ...route, requireHelper: true });

    expect(withHelper.extrasAmount).toBe(200);
    expect(withHelper.totalAmount).toBeGreaterThan(plain.totalAmount);
    // ITBIS applies to the fare plus the extras.
    expect(withHelper.taxAmount).toBeCloseTo(
      (withHelper.baseAmount + withHelper.extrasAmount) * 0.18,
      6,
    );
  });

  it('applies the minimum fare on very short routes', () => {
    const amounts = priceFor(rule(), {
      distanceKm: 0.2,
      estimatedDurationMin: 1,
    });

    expect(amounts.baseAmount).toBe(150);
  });
});
