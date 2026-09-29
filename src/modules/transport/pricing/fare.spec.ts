import { computeFare, roundCents } from './fare';

/** The verifiable example of the matching and pricing spec, §3.4. */
const SPEC_EXAMPLE = {
  baseFare: 250,
  pricePerKm: 25,
  pricePerMinute: 4,
  minimumFare: 450,
  distanceKm: 20,
  durationMin: 45,
  operatingCost: 120,
  demandMultiplier: 1.25,
  tolls: 100,
  taxRate: 0,
};

describe('computeFare', () => {
  it('reproduces the spec example line by line', () => {
    const fare = computeFare(SPEC_EXAMPLE);

    expect(fare.distanceAmount).toBe(500);
    expect(fare.durationAmount).toBe(180);
    expect(fare.operatingCost).toBe(120);
    expect(fare.variableBase).toBe(1050);
    expect(fare.serviceFare).toBe(1312.5);
    expect(fare.demandAmount).toBe(262.5);
    expect(fare.tolls).toBe(100);
    expect(fare.subtotal).toBe(1412.5);
  });

  it('multiplies the variable base, never the toll', () => {
    const withoutToll = computeFare({ ...SPEC_EXAMPLE, tolls: 0 });
    const withToll = computeFare(SPEC_EXAMPLE);

    // The toll adds exactly its own amount: 1,150 × 1.25 would be wrong.
    expect(withToll.subtotal - withoutToll.subtotal).toBe(100);
  });

  it('does not let the minimum intervene when the service is above it', () => {
    const fare = computeFare(SPEC_EXAMPLE);

    expect(fare.minimumApplied).toBe(false);
    expect(fare.serviceFare).toBeGreaterThan(450);
  });

  it('applies the minimum to the service before tolls and taxes', () => {
    const fare = computeFare({
      ...SPEC_EXAMPLE,
      distanceKm: 1,
      durationMin: 3,
      operatingCost: 0,
      demandMultiplier: 1,
      tolls: 100,
      taxRate: 0.18,
    });

    expect(fare.variableBase).toBe(287);
    expect(fare.serviceFare).toBe(450);
    expect(fare.minimumApplied).toBe(true);
    expect(fare.subtotal).toBe(550);
    expect(fare.taxAmount).toBe(99);
    expect(fare.total).toBe(649);
  });

  it('keeps taxes out of the multiplier', () => {
    const plain = computeFare({
      ...SPEC_EXAMPLE,
      demandMultiplier: 1,
      taxRate: 0.18,
    });
    const busy = computeFare({ ...SPEC_EXAMPLE, taxRate: 0.18 });

    // Tax grows only because its base grew, never by the multiplier itself.
    expect(busy.taxAmount).toBe(roundCents(busy.taxableBase * 0.18));
    expect(busy.taxAmount).not.toBe(roundCents(plain.taxAmount * 1.25));
  });

  it('can leave tolls out of the taxable base', () => {
    const fare = computeFare({
      ...SPEC_EXAMPLE,
      taxRate: 0.18,
      taxTolls: false,
    });

    expect(fare.taxableBase).toBe(1312.5);
    expect(fare.taxAmount).toBe(236.25);
  });

  it('never discounts below multiplier 1', () => {
    const fare = computeFare({ ...SPEC_EXAMPLE, demandMultiplier: 0.8 });

    expect(fare.demandMultiplier).toBe(1);
    expect(fare.demandAmount).toBe(0);
  });
});

describe('roundCents', () => {
  it('rounds half away from zero without binary artifacts', () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(1312.5)).toBe(1312.5);
  });
});
