import axios, { AxiosError } from 'axios';
import { GoogleRoutesService } from './google-routes.service';
import { GoogleRoutesError } from './errors/google-routes.error';
import type { googleMapsConfig } from './google-maps.config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type Cfg = ReturnType<typeof googleMapsConfig>;

function makeService(
  serverApiKey: string,
  useMocks = false,
): GoogleRoutesService {
  const cfg: Cfg = {
    serverApiKey,
    routesBaseUrl: 'https://routes.googleapis.com',
    placesBaseUrl: 'https://places.googleapis.com/v1',
    geocodingBaseUrl: 'https://maps.googleapis.com/maps/api/geocode/json',
    addressValidationBaseUrl:
      'https://addressvalidation.googleapis.com/v1:validateAddress',
    roadsBaseUrl: 'https://roads.googleapis.com/v1',
    routeOptimizationBaseUrl: 'https://routeoptimization.googleapis.com',
    routeOptimizationProjectId: '',
    routesTimeoutMs: 10000,
    mapsTimeoutMs: 10000,
    useMocks,
    pricingDistance: 'road',
  };
  return new GoogleRoutesService(cfg);
}

/**
 * An AxiosError shaped like a real one, so `instanceof` narrowing applies.
 *
 * `jest.mock('axios')` automocks the class too, so its constructor body never
 * runs: every field the service reads has to be assigned by hand.
 */
function axiosFailure(options: {
  code?: string;
  status?: number;
  data?: unknown;
}): AxiosError {
  const error = new AxiosError('request failed', options.code);
  error.code = options.code;

  if (options.status !== undefined) {
    error.response = {
      status: options.status,
      statusText: '',
      headers: {},
      config: { headers: {} } as never,
      data: options.data,
    };
  }

  return error;
}

describe('GoogleRoutesService', () => {
  const origin = { latitude: 18.4861, longitude: -69.9312 };
  const destination = { latitude: 18.4301, longitude: -69.6689 };

  afterEach(() => jest.clearAllMocks());

  it('falls back to an internal mock when no key is configured', async () => {
    const service = makeService('');
    expect(service.isConfigured).toBe(false);

    const route = await service.computeRoute({ origin, destination });

    expect(route.provider).toBe('internal-mock');
    expect(route.distanceKm).toBeGreaterThan(0);
    expect(route.polyline.length).toBeGreaterThan(0);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('calls the Routes API with a field mask and maps the response', async () => {
    const service = makeService('server-key');
    mockedAxios.post.mockResolvedValue({
      data: {
        routes: [
          {
            distanceMeters: 8400,
            duration: '1440s',
            polyline: { encodedPolyline: 'abc123' },
            legs: [{ distanceMeters: 8400, duration: '1440s' }],
          },
        ],
      },
    });

    const route = await service.computeRoute({ origin, destination });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<
      string,
      string
    >;
    expect(headers['X-Goog-Api-Key']).toBe('server-key');
    expect(headers['X-Goog-FieldMask']).toContain(
      'routes.polyline.encodedPolyline',
    );
    expect(route.provider).toBe('google-routes');
    expect(route.distanceKm).toBe(8.4);
    expect(route.durationMin).toBe(24);
    expect(route.polyline).toBe('abc123');
  });

  // Billing disabled, the Routes API not enabled and a restricted key all land
  // here. Distinguishing them from a transient outage is what lets the HTTP
  // layer answer something other than a bare 500.
  it('flags a 403 as provider-denied', async () => {
    const service = makeService('server-key');
    mockedAxios.post.mockRejectedValue(
      axiosFailure({
        status: 403,
        data: { error: { message: 'You must enable Billing' } },
      }),
    );

    await expect(
      service.computeRoute({ origin, destination }),
    ).rejects.toMatchObject({
      name: 'GoogleRoutesError',
      reason: 'provider-denied',
      providerStatus: 403,
    });
  });

  it('flags a timeout as provider-timeout', async () => {
    const service = makeService('server-key');
    mockedAxios.post.mockRejectedValue(axiosFailure({ code: 'ECONNABORTED' }));

    await expect(
      service.computeRoute({ origin, destination }),
    ).rejects.toMatchObject({ reason: 'provider-timeout' });
  });

  it('treats any other HTTP failure as a generic provider error', async () => {
    const service = makeService('server-key');
    mockedAxios.post.mockRejectedValue(axiosFailure({ status: 500 }));

    await expect(
      service.computeRoute({ origin, destination }),
    ).rejects.toMatchObject({ reason: 'provider-error' });
  });

  // "Google answered but there is no drivable route" is a business outcome, not
  // an outage, so it must not be flattened into one on the way out.
  it('flags an empty response as no-route', async () => {
    const service = makeService('server-key');
    mockedAxios.post.mockResolvedValue({ data: { routes: [] } });

    const error: unknown = await service
      .computeRoute({ origin, destination })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GoogleRoutesError);
    expect((error as GoogleRoutesError).reason).toBe('no-route');
  });

  it('does not call Google when the mock flag is on, even with a key', async () => {
    const service = makeService('server-key', true);

    expect(service.isConfigured).toBe(false);
    await service.computeRoute({ origin, destination });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
