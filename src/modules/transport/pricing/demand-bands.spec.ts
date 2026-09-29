import {
  DEFAULT_DEMAND_BANDS,
  normalizeBands,
  resolveBandIndex,
  smoothRatio,
} from './demand-bands';

const bands = DEFAULT_DEMAND_BANDS;
const label = (index: number) => bands[index].label;

describe('resolveBandIndex', () => {
  it.each([
    [0, 'NORMAL'],
    [1.0, 'NORMAL'],
    [1.01, 'MODERADO'],
    [1.5, 'MODERADO'],
    [1.6, 'ALTO'],
    [2.0, 'ALTO'],
    [3.5, 'MUY_ALTO'],
  ])('maps ratio %p to %s with no history', (ratio, expected) => {
    expect(label(resolveBandIndex(ratio, null, bands, 0.2))).toBe(expected);
  });

  it('goes up immediately', () => {
    expect(label(resolveBandIndex(2.5, 0, bands, 0.2))).toBe('MUY_ALTO');
  });

  it('holds the band while the ratio hovers just under its floor', () => {
    // ALTO starts above 1.5; with 0.2 hysteresis it holds down to 1.3.
    expect(label(resolveBandIndex(1.4, 2, bands, 0.2))).toBe('ALTO');
    expect(label(resolveBandIndex(1.31, 2, bands, 0.2))).toBe('ALTO');
  });

  it('steps down once the ratio clears the hysteresis margin', () => {
    expect(label(resolveBandIndex(1.3, 2, bands, 0.2))).toBe('MODERADO');
    expect(label(resolveBandIndex(0.2, 3, bands, 0.2))).toBe('NORMAL');
  });
});

describe('smoothRatio', () => {
  it('starts from the first observation', () => {
    expect(smoothRatio(2, null, 0.5)).toBe(2);
  });

  it('damps a sudden spike', () => {
    expect(smoothRatio(4, 1, 0.5)).toBe(2.5);
  });
});

describe('normalizeBands', () => {
  it('adds the catch-all band that JSON cannot express', () => {
    const result = normalizeBands([
      { above: 1.5, multiplier: 1.2, label: 'ALTO' },
      { above: 1, multiplier: 1.1, label: 'MODERADO' },
    ]);

    expect(result.map((band) => band.label)).toEqual([
      'NORMAL',
      'MODERADO',
      'ALTO',
    ]);
    expect(result[0].multiplier).toBe(1);
  });

  it('refuses discounts and falls back to the defaults when nothing is valid', () => {
    expect(normalizeBands([{ above: 1, multiplier: 0.9, label: 'X' }])).toBe(
      DEFAULT_DEMAND_BANDS,
    );
  });
});
