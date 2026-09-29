/**
 * The fare formula of the pricing spec (§3.1), in one pure function:
 *
 *   variable base = base fare + km × per km + min × per minute + operating cost
 *   service fare  = max(minimum fare, variable base × demand multiplier)
 *   subtotal      = service fare + tolls + other charges
 *   total         = subtotal + taxes
 *
 * The multiplier touches the service fare only: never tolls, taxes or
 * third-party charges. The minimum applies to the service before tolls and
 * taxes. Every amount is rounded to cents, once, with the same rule.
 */
export interface FareInputs {
  baseFare: number;
  pricePerKm: number;
  pricePerMinute: number;
  minimumFare: number;
  distanceKm: number;
  durationMin: number;
  /**
   * Fuel and maintenance go either into the per-km price or here, never both.
   * Defaults to 0 because today's rate rules carry them in the per-km price.
   */
  operatingCost?: number;
  demandMultiplier?: number;
  tolls?: number;
  /** Helper, night service and other charges outside the multiplier. */
  otherCharges?: number;
  taxRate: number;
  /** Whether tolls are part of the taxable base. */
  taxTolls?: boolean;
}

export interface FareBreakdown {
  distanceAmount: number;
  durationAmount: number;
  operatingCost: number;
  variableBase: number;
  demandMultiplier: number;
  /** Service fare at multiplier 1, minimum applied. */
  serviceBeforeDemand: number;
  serviceFare: number;
  /** serviceFare − serviceBeforeDemand: what demand added. */
  demandAmount: number;
  minimumApplied: boolean;
  tolls: number;
  otherCharges: number;
  subtotal: number;
  taxableBase: number;
  taxAmount: number;
  total: number;
}

/** Rounds to cents, half away from zero, without toFixed's binary surprises. */
export function roundCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100;
}

export function computeFare(input: FareInputs): FareBreakdown {
  const multiplier = Math.max(1, input.demandMultiplier ?? 1);
  const distanceAmount = roundCents(input.distanceKm * input.pricePerKm);
  const durationAmount = roundCents(input.durationMin * input.pricePerMinute);
  const operatingCost = roundCents(input.operatingCost ?? 0);
  const variableBase = roundCents(
    input.baseFare + distanceAmount + durationAmount + operatingCost,
  );
  const minimumFare = roundCents(input.minimumFare);

  const serviceBeforeDemand = Math.max(minimumFare, variableBase);
  const serviceFare = Math.max(
    minimumFare,
    roundCents(variableBase * multiplier),
  );
  const tolls = roundCents(input.tolls ?? 0);
  const otherCharges = roundCents(input.otherCharges ?? 0);
  const subtotal = roundCents(serviceFare + tolls + otherCharges);
  const taxableBase = roundCents(
    serviceFare + otherCharges + (input.taxTolls === false ? 0 : tolls),
  );
  const taxAmount = roundCents(taxableBase * input.taxRate);

  return {
    distanceAmount,
    durationAmount,
    operatingCost,
    variableBase,
    demandMultiplier: multiplier,
    serviceBeforeDemand,
    serviceFare,
    demandAmount: roundCents(serviceFare - serviceBeforeDemand),
    minimumApplied:
      serviceFare === minimumFare && variableBase * multiplier < minimumFare,
    tolls,
    otherCharges,
    subtotal,
    taxableBase,
    taxAmount,
    total: roundCents(subtotal + taxAmount),
  };
}
