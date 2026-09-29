import {
  compareRanked,
  DEFAULT_WEIGHTS,
  normalizeWeights,
  scoreCandidate,
  type ScoreInputs,
} from './scoring';

const base: ScoreInputs = {
  etaSeconds: 600,
  roadDistanceMeters: 4000,
  straightLineMeters: 3000,
  rating: 4.5,
  acceptanceRate: 0.9,
  tripsToday: 2,
};

describe('scoreCandidate', () => {
  it('ranks the driver who arrives first higher when the rest is equal', () => {
    const faster = scoreCandidate({ ...base, etaSeconds: 300 });
    const slower = scoreCandidate({ ...base, etaSeconds: 900 });

    expect(faster.score).toBeGreaterThan(slower.score);
  });

  it('lets ETA outweigh a better straight line', () => {
    // Closer as the crow flies, but across the river: longer by road.
    const nearButSlow = scoreCandidate({
      ...base,
      straightLineMeters: 800,
      roadDistanceMeters: 6000,
      etaSeconds: 1200,
    });
    const fartherButFast = scoreCandidate({
      ...base,
      straightLineMeters: 2000,
      roadDistanceMeters: 2500,
      etaSeconds: 360,
    });

    expect(fartherButFast.score).toBeGreaterThan(nearButSlow.score);
  });

  it('gives unrated drivers a neutral reliability, not zero', () => {
    const unrated = scoreCandidate({
      ...base,
      rating: 0,
      acceptanceRate: null,
    });

    expect(unrated.breakdown.reliability).toBe(0.8);
  });

  it('never invents an ETA component', () => {
    const noEta = scoreCandidate({ ...base, etaSeconds: null });

    expect(noEta.breakdown.eta).toBe(0);
  });

  it('keeps every component in 0..1', () => {
    const extreme = scoreCandidate({
      ...base,
      etaSeconds: 99_999,
      roadDistanceMeters: 99_999,
      tripsToday: 50,
    });

    for (const value of Object.values(extreme.breakdown)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('compareRanked', () => {
  it('puts candidates without an ETA after every candidate with one', () => {
    const rows = [
      { etaSeconds: null, score: 0.99, straightLineMeters: 100 },
      { etaSeconds: 1500, score: 0.2, straightLineMeters: 9000 },
    ];

    rows.sort(compareRanked);
    expect(rows[0].etaSeconds).toBe(1500);
  });

  it('breaks score ties by ETA, then by straight line', () => {
    const rows = [
      { etaSeconds: 600, score: 0.5, straightLineMeters: 100 },
      { etaSeconds: 300, score: 0.5, straightLineMeters: 900 },
    ];

    rows.sort(compareRanked);
    expect(rows[0].etaSeconds).toBe(300);
  });
});

describe('normalizeWeights', () => {
  it('rescales partial overrides to sum 1', () => {
    const weights = normalizeWeights({ eta: 1.1 });
    const total = Object.values(weights).reduce((sum, value) => sum + value);

    expect(total).toBeCloseTo(1, 10);
    expect(weights.eta).toBeGreaterThan(DEFAULT_WEIGHTS.eta);
  });

  it('falls back to the defaults on nonsense', () => {
    expect(normalizeWeights({ eta: -1 })).toBe(DEFAULT_WEIGHTS);
  });
});
