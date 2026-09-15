import axios from 'axios';
import { GoogleMapsPlatformService } from './google-maps-platform.service';
import type { googleMapsConfig } from './google-maps.config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type Cfg = ReturnType<typeof googleMapsConfig>;

function makeService(serverApiKey = 'server-key'): GoogleMapsPlatformService {
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
    useMocks: false,
    pricingDistance: 'road',
  };
  return new GoogleMapsPlatformService(cfg);
}

const santoDomingoEste = {
  formatted_address: 'Calle Duarte 12, Santo Domingo Este 11510, Rep. Dom.',
  geometry: { location: { lat: 18.4861, lng: -69.9312 } },
  place_id: 'abc',
  types: ['street_address'],
  address_components: [
    { long_name: '12', short_name: '12', types: ['street_number'] },
    { long_name: 'Calle Duarte', short_name: 'C. Duarte', types: ['route'] },
    {
      long_name: 'Villa Faro',
      short_name: 'Villa Faro',
      types: ['sublocality_level_1'],
    },
    {
      long_name: 'Santo Domingo Este',
      short_name: 'SDE',
      types: ['locality', 'political'],
    },
    {
      long_name: 'Santo Domingo',
      short_name: 'Santo Domingo',
      types: ['administrative_area_level_1', 'political'],
    },
    { long_name: 'República Dominicana', short_name: 'DO', types: ['country'] },
  ],
};

describe('GoogleMapsPlatformService geocoding', () => {
  afterEach(() => jest.clearAllMocks());

  it('maps an OK response and breaks the address into components', async () => {
    const service = makeService();
    mockedAxios.get.mockResolvedValue({
      data: { status: 'OK', results: [santoDomingoEste] },
    });

    const [result] = await service.reverseGeocode({
      latitude: 18.4861,
      longitude: -69.9312,
    });

    expect(result.provider).toBe('google-geocoding');
    expect(result.components.street).toBe('Calle Duarte #12');
    expect(result.components.sector).toBe('Villa Faro');
    // `locality` must win over admin_area_1 here, or the municipio slot would
    // be filled with the province name.
    expect(result.components.municipality).toBe('Santo Domingo Este');
    expect(result.components.province).toBe('Santo Domingo');
    expect(result.components.countryCode).toBe('DO');
  });

  // The bug that silently emptied the order form: the Geocoding API answers
  // HTTP 200 and hides the refusal in the body.
  it('raises instead of returning [] when the provider refuses the call', async () => {
    const service = makeService();
    mockedAxios.get.mockResolvedValue({
      data: {
        status: 'REQUEST_DENIED',
        error_message: 'You must enable Billing on the Google Cloud Project',
        results: [],
      },
    });

    await expect(
      service.reverseGeocode({ latitude: 18.4861, longitude: -69.9312 }),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'MAPS_PROVIDER_DENIED' },
    });
  });

  it('never leaks the provider message, which names the Cloud project', async () => {
    const service = makeService();
    mockedAxios.get.mockResolvedValue({
      data: {
        status: 'REQUEST_DENIED',
        error_message: 'Billing disabled for project ruta-rd-123',
        results: [],
      },
    });

    const error: unknown = await service
      .geocode({ address: 'Av. Sarasota 12' })
      .catch((caught: unknown) => caught);

    expect(JSON.stringify(error)).not.toContain('ruta-rd-123');
  });

  it('treats ZERO_RESULTS as a legitimate empty answer', async () => {
    const service = makeService();
    mockedAxios.get.mockResolvedValue({
      data: { status: 'ZERO_RESULTS', results: [] },
    });

    await expect(
      service.geocode({ address: 'Calle que no existe 999' }),
    ).resolves.toEqual([]);
  });

  it('rejects a malformed request as the caller’s fault, not an outage', async () => {
    const service = makeService();
    mockedAxios.get.mockResolvedValue({
      data: { status: 'INVALID_REQUEST', results: [] },
    });

    await expect(service.geocode({ address: 'x' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('serves the offline stub only when there is no key', async () => {
    const service = makeService('');

    const [result] = await service.geocode({ address: 'Av. Sarasota 12' });

    expect(result.provider).toBe('internal-mock');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
