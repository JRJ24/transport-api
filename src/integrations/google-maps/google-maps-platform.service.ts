import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { TtlCache, roundCoord } from '@/common/utils/ttl-cache.util';
import type { AddressValidationDto } from './dto/address-validation.dto';
import type { GeocodeDto } from './dto/geocode.dto';
import type { LatLngDto } from './dto/maps-common.dto';
import type { PlaceAutocompleteDto } from './dto/place-autocomplete.dto';
import type { PlaceDetailsDto } from './dto/place-details.dto';
import type { ReverseGeocodeDto } from './dto/reverse-geocode.dto';
import type { RouteOptimizationDto } from './dto/route-optimization.dto';
import type { SnapToRoadsDto } from './dto/snap-to-roads.dto';
import { googleMapsConfig } from './google-maps.config';

export type MapsProvider =
  | 'google-address-validation'
  | 'google-geocoding'
  | 'google-places'
  | 'google-roads'
  | 'google-route-optimization'
  | 'internal-mock';

export interface PlaceSuggestion {
  placeId: string;
  text: string;
  mainText?: string;
  secondaryText?: string;
  types: string[];
}

export interface PlaceDetailsResult {
  placeId: string;
  name: string | null;
  formattedAddress: string | null;
  location: LatLngDto | null;
  types: string[];
  googleMapsUri?: string;
  components: AddressComponents;
  provider: MapsProvider;
}

export interface RawAddressComponent {
  longName: string;
  shortName: string;
  types: string[];
}

/**
 * The address broken into the pieces the Dominican order form actually needs.
 *
 * Every field is nullable: Google omits components freely, especially in
 * informal addresses. `formattedAddress` stays on the result as the documented
 * fallback for the clients that still match provinces by substring.
 */
export interface AddressComponents {
  streetNumber: string | null;
  route: string | null;
  /** `route` and `streetNumber` composed in Dominican order: "Av. Sarasota #42". */
  street: string | null;
  sector: string | null;
  municipality: string | null;
  province: string | null;
  postalCode: string | null;
  /** ISO code, expected to be 'DO'. */
  countryCode: string | null;
  raw: RawAddressComponent[];
}

export interface GeocodeResult {
  formattedAddress: string;
  location: LatLngDto;
  placeId?: string;
  types: string[];
  components: AddressComponents;
  provider: MapsProvider;
}

export interface AddressValidationResult {
  formattedAddress: string | null;
  addressComplete: boolean;
  verdict: Record<string, unknown>;
  provider: MapsProvider;
}

export interface SnappedPoint {
  location: LatLngDto;
  originalIndex: number | null;
  placeId: string | null;
}

export type ProbedApi =
  'geocoding' | 'places' | 'routes' | 'address-validation' | 'roads';

export interface MapsApiProbe {
  api: ProbedApi;
  ok: boolean;
  httpStatus: number | null;
  /** Google's own status string: REQUEST_DENIED, PERMISSION_DENIED, ... */
  providerStatus: string | null;
  /** Google's `error_message`. Admin-only: it names the Cloud project. */
  message: string | null;
  latencyMs: number;
}

export interface MapsDiagnostics {
  keyConfigured: boolean;
  keySource: 'GOOGLE_MAPS_SERVER_API_KEY' | 'GOOGLE_MAPS_API_KEY' | 'none';
  /** Last 4 characters only: enough to tell two keys apart, useless if leaked. */
  keySuffix: string | null;
  useMocks: boolean;
  healthy: boolean;
  checkedAt: string;
  apis: MapsApiProbe[];
}

export interface RouteOptimizationResult {
  routes: unknown[];
  metrics: Record<string, unknown> | null;
  skippedShipments: unknown[];
  provider: MapsProvider;
}

/** Short, so the probe cannot stall an admin request behind a dead provider. */
const PROBE_TIMEOUT_MS = 3_000;
const PROBE_ORIGIN = { latitude: 18.4861, longitude: -69.9312 };

/** The stubs have no real address to break apart. */
function emptyAddressComponents(): AddressComponents {
  return {
    streetNumber: null,
    route: null,
    street: null,
    sector: null,
    municipality: null,
    province: null,
    postalCode: null,
    countryCode: 'DO',
    raw: [],
  };
}
const PROBE_DESTINATION = { latitude: 18.4795, longitude: -69.9124 };

/**
 * Geocoding results barely move, and both directions are billed per call. A
 * pin nudged a few metres or an address retyped after a validation error
 * should not cost twice.
 */
const REVERSE_GEOCODE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_TTL_MS = 30 * 60 * 1000;
const GEOCODE_CACHE_ENTRIES = 1_000;

@Injectable()
export class GoogleMapsPlatformService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GoogleMapsPlatformService.name);
  private static readonly probeCache = new TtlCache<MapsDiagnostics>(60_000, 1);
  private readonly geocodeCache = new TtlCache<GeocodeResult[]>(
    GEOCODE_TTL_MS,
    GEOCODE_CACHE_ENTRIES,
  );
  private readonly reverseGeocodeCache = new TtlCache<GeocodeResult[]>(
    REVERSE_GEOCODE_TTL_MS,
    GEOCODE_CACHE_ENTRIES,
  );

  constructor(
    @Inject(googleMapsConfig.KEY)
    private readonly config: ConfigType<typeof googleMapsConfig>,
  ) {}

  /**
   * Say out loud, once, which Google APIs actually answer. A dead key used to
   * be discoverable only by a customer failing to place an order.
   *
   * Never throws: a maps outage must not stop the API from booting.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    if (this.config.useMocks) {
      this.logger.warn(
        'GOOGLE_MAPS_USE_MOCKS=true: serving offline stubs, no Google calls will be made.',
      );
      return;
    }

    if (this.config.serverApiKey.length === 0) {
      this.logger.warn(
        'No Google Maps server key configured: serving offline stubs. Set GOOGLE_MAPS_SERVER_API_KEY.',
      );
      return;
    }

    try {
      const diagnostics = await this.probe();

      for (const api of diagnostics.apis) {
        if (api.ok) {
          this.logger.log(`Google ${api.api}: ok (${api.latencyMs}ms)`);
        } else {
          this.logger.warn(
            `Google ${api.api}: FAILED status=${api.providerStatus ?? api.httpStatus ?? 'n/a'} - ${api.message ?? 'no detail'}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Could not probe the Google Maps APIs at startup: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  autocompletePlaces(dto: PlaceAutocompleteDto): Promise<{
    suggestions: PlaceSuggestion[];
    provider: MapsProvider;
  }> {
    if (!this.isConfigured) {
      return Promise.resolve(this.mockAutocomplete(dto));
    }

    const body: Record<string, unknown> = {
      input: dto.input.trim(),
      includedRegionCodes: ['do'],
      languageCode: 'es',
    };

    if (dto.sessionToken) {
      body.sessionToken = dto.sessionToken;
    }

    if (dto.includedPrimaryTypes?.length) {
      body.includedPrimaryTypes = dto.includedPrimaryTypes;
    }

    if (dto.locationBias) {
      body.locationBias = {
        circle: {
          center: this.toGoogleLatLng(dto.locationBias),
          radius: dto.radiusMeters ?? 20000,
        },
      };
    }

    return axios
      .post<Record<string, unknown>>(
        `${this.config.placesBaseUrl}/places:autocomplete`,
        body,
        {
          timeout: this.config.mapsTimeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.config.serverApiKey,
            'X-Goog-FieldMask': [
              'suggestions.placePrediction.placeId',
              'suggestions.placePrediction.text',
              'suggestions.placePrediction.structuredFormat',
              'suggestions.placePrediction.types',
            ].join(','),
          },
        },
      )
      .then((response) => ({
        suggestions: this.mapPlaceSuggestions(response.data),
        provider: 'google-places' as const,
      }))
      .catch((error: unknown) => this.handleProviderError('Places API', error));
  }

  getPlaceDetails(dto: PlaceDetailsDto): Promise<PlaceDetailsResult> {
    if (!this.isConfigured) {
      return Promise.resolve(this.mockPlaceDetails(dto));
    }

    const resource = dto.placeId.startsWith('places/')
      ? dto.placeId
      : `places/${dto.placeId}`;

    return axios
      .get<Record<string, unknown>>(
        `${this.config.placesBaseUrl}/${resource}`,
        {
          timeout: this.config.mapsTimeoutMs,
          params: {
            languageCode: 'es',
            sessionToken: dto.sessionToken,
          },
          headers: {
            'X-Goog-Api-Key': this.config.serverApiKey,
            'X-Goog-FieldMask': [
              'id',
              'displayName',
              'formattedAddress',
              'location',
              'types',
              'googleMapsUri',
              'addressComponents',
            ].join(','),
          },
        },
      )
      .then((response) => this.mapPlaceDetails(response.data))
      .catch((error: unknown) => this.handleProviderError('Places API', error));
  }

  geocode(dto: GeocodeDto): Promise<GeocodeResult[]> {
    if (!this.isConfigured) {
      return Promise.resolve([this.mockGeocode(dto.address)]);
    }

    const address = dto.address.trim();
    const cacheKey = address.toLowerCase().replace(/\s+/g, ' ');
    const cached = this.geocodeCache.get(cacheKey);

    if (cached) {
      return Promise.resolve(cached);
    }

    return axios
      .get<Record<string, unknown>>(this.config.geocodingBaseUrl, {
        timeout: this.config.mapsTimeoutMs,
        params: {
          address,
          components: 'country:DO',
          language: 'es',
          key: this.config.serverApiKey,
        },
      })
      .then((response) => {
        // Only successes are cached; a thrown provider error must not be
        // pinned for half an hour after the configuration is fixed.
        // ZERO_RESULTS is a success: the address genuinely does not exist.
        const results = this.mapGeocodeResponse(response.data);
        this.geocodeCache.set(cacheKey, results);
        return results;
      })
      .catch((error: unknown) =>
        this.handleProviderError('Geocoding API', error),
      );
  }

  reverseGeocode(dto: ReverseGeocodeDto): Promise<GeocodeResult[]> {
    if (!this.isConfigured) {
      return Promise.resolve([
        this.mockGeocode(`${dto.latitude}, ${dto.longitude}`, dto),
      ]);
    }

    const cacheKey = `${roundCoord(dto.latitude)},${roundCoord(dto.longitude)}`;
    const cached = this.reverseGeocodeCache.get(cacheKey);

    if (cached) {
      return Promise.resolve(cached);
    }

    return axios
      .get<Record<string, unknown>>(this.config.geocodingBaseUrl, {
        timeout: this.config.mapsTimeoutMs,
        params: {
          latlng: `${dto.latitude},${dto.longitude}`,
          language: 'es',
          key: this.config.serverApiKey,
        },
      })
      .then((response) => {
        const results = this.mapGeocodeResponse(response.data);
        this.reverseGeocodeCache.set(cacheKey, results);
        return results;
      })
      .catch((error: unknown) =>
        this.handleProviderError('Geocoding API', error),
      );
  }

  validateAddress(dto: AddressValidationDto): Promise<AddressValidationResult> {
    if (!this.isConfigured) {
      return Promise.resolve(this.mockAddressValidation(dto));
    }

    return axios
      .post<Record<string, unknown>>(
        `${this.config.addressValidationBaseUrl}?key=${this.config.serverApiKey}`,
        {
          address: {
            regionCode: dto.regionCode ?? 'DO',
            addressLines: dto.addressLines.map((line) => line.trim()),
            locality: dto.locality,
            administrativeArea: dto.administrativeArea,
            postalCode: dto.postalCode,
          },
          languageOptions: { returnEnglishLatinAddress: false },
        },
        { timeout: this.config.mapsTimeoutMs },
      )
      .then((response) => this.mapAddressValidation(response.data))
      .catch((error: unknown) =>
        this.handleProviderError('Address Validation API', error),
      );
  }

  snapToRoads(dto: SnapToRoadsDto): Promise<{
    snappedPoints: SnappedPoint[];
    provider: MapsProvider;
  }> {
    if (!this.isConfigured) {
      return Promise.resolve(this.mockSnapToRoads(dto));
    }

    return axios
      .get<Record<string, unknown>>(`${this.config.roadsBaseUrl}/snapToRoads`, {
        timeout: this.config.mapsTimeoutMs,
        params: {
          path: dto.points
            .map((point) => `${point.latitude},${point.longitude}`)
            .join('|'),
          interpolate: dto.interpolate ?? true,
          key: this.config.serverApiKey,
        },
      })
      .then((response) => ({
        snappedPoints: this.mapSnappedPoints(response.data),
        provider: 'google-roads' as const,
      }))
      .catch((error: unknown) => this.handleProviderError('Roads API', error));
  }

  optimizeRoutes(dto: RouteOptimizationDto): Promise<RouteOptimizationResult> {
    if (!this.isConfigured || !this.config.routeOptimizationProjectId) {
      return Promise.resolve(this.mockRouteOptimization(dto));
    }

    const url = `${this.config.routeOptimizationBaseUrl}/v1/projects/${this.config.routeOptimizationProjectId}:optimizeTours`;

    return axios
      .post<Record<string, unknown>>(
        url,
        {
          model: {
            shipments: dto.shipments,
            vehicles: dto.vehicles,
            globalStartTime: dto.globalStartTime,
            globalEndTime: dto.globalEndTime,
          },
        },
        {
          timeout: this.config.mapsTimeoutMs,
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.config.serverApiKey,
          },
        },
      )
      .then((response) => this.mapRouteOptimization(response.data))
      .catch((error: unknown) =>
        this.handleProviderError('Route Optimization API', error),
      );
  }

  /**
   * One cheap call per Google API, so "is billing actually on?" is answerable
   * from inside the product instead of only from the browser console.
   *
   * Cached for a minute: this endpoint costs money, and a refresh-happy admin
   * should not be able to turn it into a billing amplifier.
   */
  async probe(): Promise<MapsDiagnostics> {
    const cached = GoogleMapsPlatformService.probeCache.get('probe');
    if (cached) {
      return cached;
    }

    const key = this.config.serverApiKey;
    const apis = await Promise.all([
      this.probeGeocoding(),
      this.probeRest('places', () =>
        axios.post(
          `${this.config.placesBaseUrl}/places:autocomplete`,
          { input: 'Duarte', includedRegionCodes: ['do'], languageCode: 'es' },
          {
            timeout: PROBE_TIMEOUT_MS,
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': key,
              'X-Goog-FieldMask': 'suggestions.placePrediction.placeId',
            },
          },
        ),
      ),
      this.probeRest('routes', () =>
        axios.post(
          `${this.config.routesBaseUrl}/directions/v2:computeRoutes`,
          {
            origin: { location: { latLng: PROBE_ORIGIN } },
            destination: { location: { latLng: PROBE_DESTINATION } },
            travelMode: 'DRIVE',
          },
          {
            timeout: PROBE_TIMEOUT_MS,
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': key,
              'X-Goog-FieldMask': 'routes.distanceMeters',
            },
          },
        ),
      ),
      this.probeRest('address-validation', () =>
        axios.post(
          `${this.config.addressValidationBaseUrl}?key=${key}`,
          {
            address: {
              regionCode: 'DO',
              addressLines: ['Av. Winston Churchill 1'],
            },
          },
          { timeout: PROBE_TIMEOUT_MS },
        ),
      ),
      this.probeRest('roads', () =>
        axios.get(`${this.config.roadsBaseUrl}/snapToRoads`, {
          timeout: PROBE_TIMEOUT_MS,
          params: {
            path: `${PROBE_ORIGIN.latitude},${PROBE_ORIGIN.longitude}|${PROBE_DESTINATION.latitude},${PROBE_DESTINATION.longitude}`,
            key,
          },
        }),
      ),
    ]);

    const diagnostics: MapsDiagnostics = {
      keyConfigured: key.length > 0,
      keySource: process.env.GOOGLE_MAPS_SERVER_API_KEY
        ? 'GOOGLE_MAPS_SERVER_API_KEY'
        : process.env.GOOGLE_MAPS_API_KEY
          ? 'GOOGLE_MAPS_API_KEY'
          : 'none',
      keySuffix: key.length >= 4 ? key.slice(-4) : null,
      useMocks: this.config.useMocks,
      healthy: apis.every((entry) => entry.ok),
      checkedAt: new Date().toISOString(),
      apis,
    };

    GoogleMapsPlatformService.probeCache.set('probe', diagnostics);
    return diagnostics;
  }

  /**
   * Geocoding is the odd one out: it answers 200 with the refusal in the body,
   * so a probe that only looked at the HTTP status would report it healthy.
   */
  private async probeGeocoding(): Promise<MapsApiProbe> {
    const startedAt = Date.now();

    try {
      const response = await axios.get<Record<string, unknown>>(
        this.config.geocodingBaseUrl,
        {
          timeout: PROBE_TIMEOUT_MS,
          params: {
            latlng: `${PROBE_ORIGIN.latitude},${PROBE_ORIGIN.longitude}`,
            language: 'es',
            key: this.config.serverApiKey,
          },
        },
      );

      const status = this.stringValue(response.data.status) ?? 'UNKNOWN_ERROR';

      return {
        api: 'geocoding',
        ok: status === 'OK' || status === 'ZERO_RESULTS',
        httpStatus: response.status,
        providerStatus: status,
        message: this.stringValue(response.data.error_message) ?? null,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.probeFailure('geocoding', error, startedAt);
    }
  }

  private async probeRest(
    api: ProbedApi,
    call: () => Promise<{ status: number }>,
  ): Promise<MapsApiProbe> {
    const startedAt = Date.now();

    try {
      const response = await call();

      return {
        api,
        ok: true,
        httpStatus: response.status,
        providerStatus: null,
        message: null,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return this.probeFailure(api, error, startedAt);
    }
  }

  private probeFailure(
    api: ProbedApi,
    error: unknown,
    startedAt: number,
  ): MapsApiProbe {
    const axiosError = error instanceof AxiosError ? error : null;
    const body = this.asRecord(axiosError?.response?.data).error;

    return {
      api,
      ok: false,
      httpStatus: axiosError?.response?.status ?? null,
      providerStatus:
        this.stringValue(this.asRecord(body).status) ??
        axiosError?.code ??
        null,
      message:
        this.providerErrorMessage(axiosError?.response?.data) ??
        (error instanceof Error ? error.message : null),
      latencyMs: Date.now() - startedAt,
    };
  }

  /**
   * Real calls happen only with a key AND without the mock opt-in. A key that
   * is present but rejected by Google therefore raises a typed error instead of
   * quietly falling back to fake Santo Domingo coordinates.
   */
  private get isConfigured(): boolean {
    return !this.config.useMocks && this.config.serverApiKey.length > 0;
  }

  private mapPlaceSuggestions(
    data: Record<string, unknown>,
  ): PlaceSuggestion[] {
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];

    return suggestions
      .map((item) => {
        const prediction = this.asRecord(item).placePrediction;
        const placePrediction = this.asRecord(prediction);
        const structuredFormat = this.asRecord(
          placePrediction.structuredFormat,
        );
        const mainText = this.textValue(structuredFormat.mainText);
        const secondaryText = this.textValue(structuredFormat.secondaryText);
        const text = this.textValue(placePrediction.text) ?? mainText;
        const placeId = this.stringValue(placePrediction.placeId);

        if (!placeId || !text) {
          return null;
        }

        return {
          placeId,
          text,
          ...(mainText && { mainText }),
          ...(secondaryText && { secondaryText }),
          types: this.stringArray(placePrediction.types),
        };
      })
      .filter(
        (suggestion): suggestion is PlaceSuggestion => suggestion !== null,
      );
  }

  private mapPlaceDetails(data: Record<string, unknown>): PlaceDetailsResult {
    const location = this.asRecord(data.location);
    const latitude = this.numberValue(location.latitude);
    const longitude = this.numberValue(location.longitude);

    return {
      placeId: this.stringValue(data.id) ?? '',
      name: this.textValue(data.displayName) ?? null,
      formattedAddress: this.stringValue(data.formattedAddress) ?? null,
      location:
        latitude === null || longitude === null
          ? null
          : { latitude, longitude },
      types: this.stringArray(data.types),
      ...(this.stringValue(data.googleMapsUri) && {
        googleMapsUri: this.stringValue(data.googleMapsUri),
      }),
      components: this.parseAddressComponents(data.addressComponents),
      provider: 'google-places',
    };
  }

  /**
   * The legacy Geocoding JSON API answers **HTTP 200 even when it refuses the
   * call**, putting the real outcome in `status` and `error_message`. Reading
   * only `results` therefore turned "billing is disabled" into a silent empty
   * array, which is exactly why the order form stopped filling itself in.
   */
  private mapGeocodeResponse(data: Record<string, unknown>): GeocodeResult[] {
    const status = this.stringValue(data.status) ?? 'UNKNOWN_ERROR';
    const providerMessage = this.stringValue(data.error_message);

    if (status === 'OK') {
      return this.mapGeocodeResults(data);
    }

    if (status === 'ZERO_RESULTS') {
      return [];
    }

    if (status === 'INVALID_REQUEST') {
      this.logger.warn(
        `Geocoding API rejected the request: ${providerMessage ?? 'no detail'}`,
      );
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'La direccion enviada no es valida',
      });
    }

    // `error_message` names the Cloud project and the billing console URL, so
    // it is logged in full and never serialized to the client.
    this.logger.error(
      `Geocoding API failed: status=${status} message=${providerMessage ?? 'n/a'}`,
    );

    if (status === 'REQUEST_DENIED') {
      throw this.providerDenied('Geocoding API');
    }

    if (status === 'OVER_QUERY_LIMIT' || status === 'OVER_DAILY_LIMIT') {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.MAPS_PROVIDER_QUOTA_EXCEEDED,
        message: 'Se agoto la cuota del servicio de mapas',
      });
    }

    throw new ServiceUnavailableException({
      code: ERROR_CODES.MAPS_PROVIDER_UNAVAILABLE,
      message: 'El servicio de mapas no esta disponible temporalmente',
    });
  }

  /**
   * Billing not enabled, the API not activated and a key restricted to other
   * APIs all arrive as the same refusal. It is our configuration that is wrong,
   * so it is a 503 and not the caller's fault.
   */
  private providerDenied(service: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: ERROR_CODES.MAPS_PROVIDER_DENIED,
      message: `El servicio de mapas no esta disponible (configuracion del proveedor: ${service})`,
    });
  }

  /**
   * Normalizes the address components of either Google dialect.
   *
   * The legacy Geocoding API returns `address_components` with
   * `long_name`/`short_name`; Places (New) returns `addressComponents` with
   * `longText`/`shortText`. One parser for both means the clients see a single
   * shape whether the customer typed an address or picked a suggestion.
   */
  private parseAddressComponents(value: unknown): AddressComponents {
    const raw: RawAddressComponent[] = (Array.isArray(value) ? value : [])
      .map((item) => {
        const record = this.asRecord(item);
        const longName =
          this.stringValue(record.long_name) ??
          this.stringValue(record.longText);
        const shortName =
          this.stringValue(record.short_name) ??
          this.stringValue(record.shortText) ??
          longName;

        return longName
          ? {
              longName,
              shortName: shortName ?? longName,
              types: this.stringArray(record.types),
            }
          : null;
      })
      .filter((item): item is RawAddressComponent => item !== null);

    const pick = (
      types: string[],
      field: 'longName' | 'shortName' = 'longName',
    ): string | null => {
      for (const type of types) {
        const match = raw.find((component) => component.types.includes(type));
        if (match) {
          return match[field];
        }
      }
      return null;
    };

    const route = pick(['route']);
    const streetNumber = pick(['street_number']);

    return {
      streetNumber,
      route,
      street: route
        ? streetNumber
          ? `${route} #${streetNumber}`
          : route
        : null,
      sector: pick(['sublocality_level_1', 'sublocality', 'neighborhood']),
      // `locality` first is critical in the DR: for a Santo Domingo Este
      // address Google returns locality "Santo Domingo Este" (the municipio)
      // and administrative_area_level_1 "Santo Domingo" (the province). Reading
      // admin_area_2 first would put the province name in the municipio slot.
      municipality: pick([
        'locality',
        'administrative_area_level_2',
        'administrative_area_level_3',
        'administrative_area_level_4',
      ]),
      province: pick(['administrative_area_level_1']),
      postalCode: pick(['postal_code']),
      countryCode: pick(['country'], 'shortName'),
      raw,
    };
  }

  private mapGeocodeResults(data: Record<string, unknown>): GeocodeResult[] {
    const results = Array.isArray(data.results) ? data.results : [];

    return results
      .map((item): GeocodeResult | null => {
        const result = this.asRecord(item);
        const geometry = this.asRecord(result.geometry);
        const location = this.asRecord(geometry.location);
        const latitude = this.numberValue(location.lat);
        const longitude = this.numberValue(location.lng);
        const formattedAddress = this.stringValue(result.formatted_address);

        if (!formattedAddress || latitude === null || longitude === null) {
          return null;
        }

        return {
          formattedAddress,
          location: { latitude, longitude },
          ...(this.stringValue(result.place_id) && {
            placeId: this.stringValue(result.place_id),
          }),
          types: this.stringArray(result.types),
          components: this.parseAddressComponents(result.address_components),
          provider: 'google-geocoding' as const,
        };
      })
      .filter((result): result is GeocodeResult => result !== null);
  }

  private mapAddressValidation(
    data: Record<string, unknown>,
  ): AddressValidationResult {
    const result = this.asRecord(data.result);
    const verdict = this.asRecord(result.verdict);
    const address = this.asRecord(result.address);

    return {
      formattedAddress: this.stringValue(address.formattedAddress) ?? null,
      addressComplete: Boolean(verdict.addressComplete),
      verdict,
      provider: 'google-address-validation',
    };
  }

  private mapSnappedPoints(data: Record<string, unknown>): SnappedPoint[] {
    const points = Array.isArray(data.snappedPoints) ? data.snappedPoints : [];

    return points
      .map((item): SnappedPoint | null => {
        const point = this.asRecord(item);
        const location = this.asRecord(point.location);
        const latitude = this.numberValue(location.latitude);
        const longitude = this.numberValue(location.longitude);

        if (latitude === null || longitude === null) {
          return null;
        }

        return {
          location: { latitude, longitude },
          originalIndex: this.numberValue(point.originalIndex),
          placeId: this.stringValue(point.placeId) ?? null,
        };
      })
      .filter((point): point is SnappedPoint => point !== null);
  }

  private mapRouteOptimization(
    data: Record<string, unknown>,
  ): RouteOptimizationResult {
    return {
      routes: Array.isArray(data.routes) ? data.routes : [],
      metrics: this.nullableRecord(data.metrics),
      skippedShipments: Array.isArray(data.skippedShipments)
        ? data.skippedShipments
        : [],
      provider: 'google-route-optimization',
    };
  }

  private mockAutocomplete(dto: PlaceAutocompleteDto) {
    const text = dto.input.trim();

    return {
      suggestions: [
        {
          placeId: `mock:${encodeURIComponent(text)}`,
          text,
          mainText: text,
          secondaryText: 'Republica Dominicana',
          types: ['street_address'],
        },
      ],
      provider: 'internal-mock' as const,
    };
  }

  private mockPlaceDetails(dto: PlaceDetailsDto): PlaceDetailsResult {
    const value = dto.placeId.startsWith('mock:')
      ? decodeURIComponent(dto.placeId.replace(/^mock:/, ''))
      : dto.placeId;

    return {
      placeId: dto.placeId,
      name: value,
      formattedAddress: value,
      location: { latitude: 18.4861, longitude: -69.9312 },
      types: ['street_address'],
      components: emptyAddressComponents(),
      provider: 'internal-mock',
    };
  }

  private mockGeocode(address: string, location?: LatLngDto): GeocodeResult {
    return {
      formattedAddress: address,
      location: location ?? { latitude: 18.4861, longitude: -69.9312 },
      placeId: `mock:${encodeURIComponent(address)}`,
      types: ['street_address'],
      components: emptyAddressComponents(),
      provider: 'internal-mock',
    };
  }

  private mockAddressValidation(
    dto: AddressValidationDto,
  ): AddressValidationResult {
    const formattedAddress = [
      ...dto.addressLines,
      dto.locality,
      dto.administrativeArea,
      dto.regionCode ?? 'DO',
    ]
      .filter(Boolean)
      .join(', ');

    return {
      formattedAddress,
      addressComplete: dto.addressLines.length > 0,
      verdict: {
        addressComplete: dto.addressLines.length > 0,
        inputGranularity: 'PREMISE',
        validationGranularity: 'PREMISE',
        geocodeGranularity: 'PREMISE',
      },
      provider: 'internal-mock',
    };
  }

  private mockSnapToRoads(dto: SnapToRoadsDto) {
    return {
      snappedPoints: dto.points.map((point, index) => ({
        location: point,
        originalIndex: index,
        placeId: null,
      })),
      provider: 'internal-mock' as const,
    };
  }

  private mockRouteOptimization(
    dto: RouteOptimizationDto,
  ): RouteOptimizationResult {
    const routes = dto.vehicles.map((vehicle, vehicleIndex) => ({
      vehicleIndex,
      vehicle,
      visits: dto.shipments
        .map((shipment, shipmentIndex) => ({ shipmentIndex, shipment }))
        .filter(
          (_visit, shipmentIndex) =>
            shipmentIndex % dto.vehicles.length === vehicleIndex,
        ),
    }));

    return {
      routes,
      metrics: {
        totalShipments: dto.shipments.length,
        totalVehicles: dto.vehicles.length,
      },
      skippedShipments: [],
      provider: 'internal-mock',
    };
  }

  private handleProviderError(service: string, error: unknown): never {
    // `mapGeocodeResponse` throws from inside the `.then()`, so its typed
    // errors land in the same `.catch()`. Re-classifying them here would
    // downgrade a precise MAPS_PROVIDER_DENIED into a generic outage, and turn
    // a 400 into a 503.
    if (error instanceof HttpException) {
      throw error;
    }

    if (!(error instanceof AxiosError)) {
      this.logger.error(
        `${service} request failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new ServiceUnavailableException({
        code: ERROR_CODES.MAPS_PROVIDER_UNAVAILABLE,
        message: 'El servicio de mapas no esta disponible temporalmente',
      });
    }

    const status = error.response?.status;
    const detail = this.providerErrorMessage(error.response?.data);
    this.logger.error(
      `${service} request failed: status=${status ?? 'n/a'} code=${error.code ?? 'n/a'} message=${detail ?? 'n/a'}`,
    );

    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new GatewayTimeoutException({
        code: ERROR_CODES.UPSTREAM_TIMEOUT,
        message: 'El servicio de mapas tardo demasiado en responder',
      });
    }

    if (status === 401 || status === 403) {
      throw this.providerDenied(service);
    }

    if (status === 429) {
      throw new ServiceUnavailableException({
        code: ERROR_CODES.MAPS_PROVIDER_QUOTA_EXCEEDED,
        message: 'Se agoto la cuota del servicio de mapas',
      });
    }

    // A 4xx here means our own payload is wrong, which is a bug on our side,
    // not a provider outage.
    if (status === 400 || status === 404) {
      throw new BadGatewayException({
        code: ERROR_CODES.UPSTREAM_ERROR,
        message: `${service} rechazo la peticion`,
      });
    }

    throw new ServiceUnavailableException({
      code: ERROR_CODES.MAPS_PROVIDER_UNAVAILABLE,
      message: 'El servicio de mapas no esta disponible temporalmente',
    });
  }

  /** Google REST errors nest the human-readable reason under `error.message`. */
  private providerErrorMessage(data: unknown): string | undefined {
    return this.stringValue(this.asRecord(this.asRecord(data).error).message);
  }

  private toGoogleLatLng(point: LatLngDto): {
    latitude: number;
    longitude: number;
  } {
    return { latitude: point.latitude, longitude: point.longitude };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  }

  private nullableRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private textValue(value: unknown): string | undefined {
    const record = this.asRecord(value);

    return this.stringValue(record.text) ?? this.stringValue(value);
  }

  private numberValue(value: unknown): number | null {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
