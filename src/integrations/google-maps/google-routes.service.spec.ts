import axios from 'axios';
import { GoogleRoutesService } from './google-routes.service';
import type { googleMapsConfig } from './google-maps.config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type Cfg = ReturnType<typeof googleMapsConfig>;

function makeService(serverApiKey: string): GoogleRoutesService {
  const cfg: Cfg = {
    serverApiKey,
    routesBaseUrl: 'https://routes.googleapis.com',
    routesTimeoutMs: 10000,
  };
  return new GoogleRoutesService(cfg);
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
});
