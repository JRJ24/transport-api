import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
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
  addressComponents?: unknown[];
  provider: MapsProvider;
}

export interface GeocodeResult {
  formattedAddress: string;
  location: LatLngDto;
  placeId?: string;
  types: string[];
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

export interface RouteOptimizationResult {
  routes: unknown[];
  metrics: Record<string, unknown> | null;
  skippedShipments: unknown[];
  provider: MapsProvider;
}

@Injectable()
export class GoogleMapsPlatformService {
  private readonly logger = new Logger(GoogleMapsPlatformService.name);

  constructor(
    @Inject(googleMapsConfig.KEY)
    private readonly config: ConfigType<typeof googleMapsConfig>,
  ) {}

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

    return axios
      .get<Record<string, unknown>>(this.config.geocodingBaseUrl, {
        timeout: this.config.mapsTimeoutMs,
        params: {
          address: dto.address.trim(),
          components: 'country:DO',
          language: 'es',
          key: this.config.serverApiKey,
        },
      })
      .then((response) => this.mapGeocodeResults(response.data))
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

    return axios
      .get<Record<string, unknown>>(this.config.geocodingBaseUrl, {
        timeout: this.config.mapsTimeoutMs,
        params: {
          latlng: `${dto.latitude},${dto.longitude}`,
          language: 'es',
          key: this.config.serverApiKey,
        },
      })
      .then((response) => this.mapGeocodeResults(response.data))
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

  private get isConfigured(): boolean {
    return this.config.serverApiKey.length > 0;
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
      ...(Array.isArray(data.addressComponents) && {
        addressComponents: data.addressComponents,
      }),
      provider: 'google-places',
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
      provider: 'internal-mock',
    };
  }

  private mockGeocode(address: string, location?: LatLngDto): GeocodeResult {
    return {
      formattedAddress: address,
      location: location ?? { latitude: 18.4861, longitude: -69.9312 },
      placeId: `mock:${encodeURIComponent(address)}`,
      types: ['street_address'],
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
    if (error instanceof AxiosError) {
      this.logger.error(
        `${service} request failed: status=${error.response?.status ?? 'n/a'} code=${error.code ?? 'n/a'}`,
      );
    } else {
      this.logger.error(
        `${service} request failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    throw new BadGatewayException({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: `${service} is temporarily unavailable`,
    });
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
