import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { TRACKING_BATCH_HARD_MAX } from '@/config/tracking.config';
import { BatchLocationsDto } from './batch-locations.dto';

// Mismas opciones que el ValidationPipe global de main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  stopAtFirstError: false,
});

function body(count: number) {
  return {
    locations: Array.from({ length: count }, (_, i) => ({
      latitude: 18.48,
      longitude: -69.93,
      recordedAt: new Date().toISOString(),
      sequence: i + 1,
      clientId: `client-${i + 1}`,
    })),
  };
}

function validate(value: unknown) {
  return pipe.transform(value, { type: 'body', metatype: BatchLocationsDto });
}

describe('BatchLocationsDto', () => {
  it('keeps accepting batches up to the absolute cap', async () => {
    expect(TRACKING_BATCH_HARD_MAX).toBe(500);
    await expect(
      validate(body(TRACKING_BATCH_HARD_MAX)),
    ).resolves.toBeInstanceOf(BatchLocationsDto);
  });

  it.each([0, TRACKING_BATCH_HARD_MAX + 1])(
    'rejects a batch of %i locations with 400',
    async (count) => {
      await expect(validate(body(count))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
});
