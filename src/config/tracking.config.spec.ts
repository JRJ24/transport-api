import { TRACKING_BATCH_HARD_MAX, trackingConfig } from './tracking.config';

describe('trackingConfig', () => {
  const original = process.env.TRACKING_MAX_BATCH;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TRACKING_MAX_BATCH;
    } else {
      process.env.TRACKING_MAX_BATCH = original;
    }
  });

  it('defaults maxBatchSize to the DTO cap', () => {
    delete process.env.TRACKING_MAX_BATCH;
    expect(trackingConfig().maxBatchSize).toBe(TRACKING_BATCH_HARD_MAX);
  });

  it('lets TRACKING_MAX_BATCH lower the limit', () => {
    process.env.TRACKING_MAX_BATCH = '150';
    expect(trackingConfig().maxBatchSize).toBe(150);
  });

  it('never raises the limit above the DTO cap', () => {
    process.env.TRACKING_MAX_BATCH = '1000';
    expect(trackingConfig().maxBatchSize).toBe(TRACKING_BATCH_HARD_MAX);
  });
});
