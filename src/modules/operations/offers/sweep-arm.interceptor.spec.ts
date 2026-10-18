import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import type { OfferSchedulerService } from './offer-scheduler.service';
import { SweepArmInterceptor } from './sweep-arm.interceptor';

function http(url: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: url }) }),
  } as unknown as ExecutionContext;
}

const next: CallHandler = { handle: () => of(null) };

describe('SweepArmInterceptor', () => {
  afterEach(() => jest.useRealTimers());

  it('arms on traffic at most once per 30 s', () => {
    jest.useFakeTimers({ now: 0 });
    const scheduler = { arm: jest.fn() } as unknown as OfferSchedulerService;
    const interceptor = new SweepArmInterceptor(scheduler);

    interceptor.intercept(http('/api/v1/orders'), next);
    interceptor.intercept(http('/api/v1/orders'), next);
    expect(scheduler.arm).toHaveBeenCalledTimes(1);

    jest.setSystemTime(30_000);
    interceptor.intercept(http('/api/v1/orders'), next);
    expect(scheduler.arm).toHaveBeenCalledTimes(2);
  });

  it('ignores health probes', () => {
    const scheduler = { arm: jest.fn() } as unknown as OfferSchedulerService;
    const interceptor = new SweepArmInterceptor(scheduler);

    interceptor.intercept(http('/api/v1/health'), next);
    interceptor.intercept(http('/api/v1/health/ready'), next);

    expect(scheduler.arm).not.toHaveBeenCalled();
  });
});
