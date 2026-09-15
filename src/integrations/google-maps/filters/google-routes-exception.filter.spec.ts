import type { ArgumentsHost } from '@nestjs/common';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { GoogleRoutesError } from '../errors/google-routes.error';
import { GoogleRoutesExceptionFilter } from './google-routes-exception.filter';

function makeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/api/v1/routes/compute' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, json, status };
}

describe('GoogleRoutesExceptionFilter', () => {
  const filter = new GoogleRoutesExceptionFilter();

  // The whole point: none of these may come out as a bare 500.
  const cases: [GoogleRoutesError, number, string][] = [
    [GoogleRoutesError.noRoute(), 422, ERROR_CODES.ROUTE_NOT_FOUND],
    [
      new GoogleRoutesError('denied', 403, undefined, 'provider-denied'),
      503,
      ERROR_CODES.MAPS_PROVIDER_DENIED,
    ],
    [
      new GoogleRoutesError('slow', undefined, undefined, 'provider-timeout'),
      504,
      ERROR_CODES.UPSTREAM_TIMEOUT,
    ],
    [
      new GoogleRoutesError('bad payload', 400, undefined, 'provider-error'),
      502,
      ERROR_CODES.UPSTREAM_ERROR,
    ],
    [
      new GoogleRoutesError('boom', 500, undefined, 'provider-error'),
      503,
      ERROR_CODES.ROUTE_PROVIDER_UNAVAILABLE,
    ],
  ];

  it.each(cases)('maps %s', (error, expectedStatus, expectedCode) => {
    const { host, json, status } = makeHost();

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: expectedCode }),
      }),
    );
  });

  it('never serializes the provider payload', () => {
    const { host, json } = makeHost();
    const secret = { error: { message: 'project ruta-rd-123 has no billing' } };

    filter.catch(
      new GoogleRoutesError('denied', 403, secret, 'provider-denied'),
      host,
    );

    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('ruta-rd-123');
  });
});
