/**
 * Supply/demand bands for the demand multiplier (spec §3.2).
 *
 * A band applies when the smoothed ratio is strictly above `above`. Values are
 * starting points to simulate in `shadow` mode, not an approved tariff.
 */
export interface DemandBand {
  above: number;
  multiplier: number;
  label: string;
}

export const DEFAULT_DEMAND_BANDS: DemandBand[] = [
  { above: Number.NEGATIVE_INFINITY, multiplier: 1, label: 'NORMAL' },
  { above: 1.0, multiplier: 1.1, label: 'MODERADO' },
  { above: 1.5, multiplier: 1.2, label: 'ALTO' },
  { above: 2.0, multiplier: 1.35, label: 'MUY_ALTO' },
];

/** Bands sorted ascending, with a catch-all first band guaranteed. */
export function normalizeBands(bands: DemandBand[] | undefined): DemandBand[] {
  const valid = (bands ?? []).filter(
    (band) =>
      Number.isFinite(band.multiplier) &&
      band.multiplier >= 1 &&
      (Number.isFinite(band.above) || band.above === Number.NEGATIVE_INFINITY),
  );
  if (valid.length === 0) {
    return DEFAULT_DEMAND_BANDS;
  }
  const sorted = [...valid].sort((a, b) => a.above - b.above);
  if (sorted[0].above !== Number.NEGATIVE_INFINITY) {
    sorted.unshift({
      above: Number.NEGATIVE_INFINITY,
      multiplier: 1,
      label: 'NORMAL',
    });
  }
  return sorted;
}

/** Exponential moving average; the first observation stands alone. */
export function smoothRatio(
  ratio: number,
  previous: number | null,
  weight: number,
): number {
  if (previous === null || !Number.isFinite(previous)) {
    return ratio;
  }
  return weight * ratio + (1 - weight) * previous;
}

/**
 * The band for `ratio`, with hysteresis on the way down: once a band is
 * reached the ratio must fall `hysteresis` below its floor before stepping
 * back, so a ratio hovering on a threshold does not make prices flicker.
 * Going up is immediate.
 */
export function resolveBandIndex(
  ratio: number,
  previousIndex: number | null,
  bands: DemandBand[],
  hysteresis: number,
): number {
  let target = 0;
  bands.forEach((band, index) => {
    if (ratio > band.above) {
      target = index;
    }
  });

  if (previousIndex === null || previousIndex <= target) {
    return target;
  }

  // Step down only as far as the hysteresis margin allows.
  let index = Math.min(previousIndex, bands.length - 1);
  while (index > target && ratio <= bands[index].above - hysteresis) {
    index -= 1;
  }
  return index;
}
