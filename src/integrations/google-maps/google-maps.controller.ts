import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { AddressValidationDto } from './dto/address-validation.dto';
import { GeocodeDto } from './dto/geocode.dto';
import { PlaceAutocompleteDto } from './dto/place-autocomplete.dto';
import { PlaceDetailsDto } from './dto/place-details.dto';
import { ReverseGeocodeDto } from './dto/reverse-geocode.dto';
import { RouteOptimizationDto } from './dto/route-optimization.dto';
import { SnapToRoadsDto } from './dto/snap-to-roads.dto';
import { GoogleMapsPlatformService } from './google-maps-platform.service';

/**
 * Per-endpoint rate limits. Every call here is billed by Google, and the
 * clients fire them from debounced keystrokes and marker drags, so the global
 * 100/min is far too loose a guard for the expensive ones.
 */
const perMinute = (limit: number) =>
  Throttle({ default: { limit, ttl: 60_000 } });

@ApiTags('maps')
@ApiBearerAuth()
@Controller('maps')
export class GoogleMapsController {
  constructor(private readonly service: GoogleMapsPlatformService) {}

  @ApiOperation({ summary: 'Autocomplete places and addresses' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @perMinute(60)
  @Post('places/autocomplete')
  autocompletePlaces(@Body() dto: PlaceAutocompleteDto) {
    return this.service.autocompletePlaces(dto);
  }

  @ApiOperation({ summary: 'Get place details' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @perMinute(30)
  @Post('places/details')
  getPlaceDetails(@Body() dto: PlaceDetailsDto) {
    return this.service.getPlaceDetails(dto);
  }

  @ApiOperation({ summary: 'Convert an address into coordinates' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @perMinute(30)
  @Post('geocode')
  geocode(@Body() dto: GeocodeDto) {
    return this.service.geocode(dto);
  }

  @ApiOperation({ summary: 'Convert GPS coordinates into a readable address' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @perMinute(60)
  @Post('reverse-geocode')
  reverseGeocode(@Body() dto: ReverseGeocodeDto) {
    return this.service.reverseGeocode(dto);
  }

  @ApiOperation({ summary: 'Validate and normalize a postal address' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @perMinute(20)
  @Post('address-validation')
  validateAddress(@Body() dto: AddressValidationDto) {
    return this.service.validateAddress(dto);
  }

  @ApiOperation({ summary: 'Snap GPS points to roads' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.DRIVER)
  @perMinute(30)
  @Post('roads/snap')
  snapToRoads(@Body() dto: SnapToRoadsDto) {
    return this.service.snapToRoads(dto);
  }

  @ApiOperation({ summary: 'Optimize multiple shipments and vehicles' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @perMinute(5)
  @Post('route-optimization')
  optimizeRoutes(@Body() dto: RouteOptimizationDto) {
    return this.service.optimizeRoutes(dto);
  }

  @ApiOperation({
    summary: 'Probe every Google Maps API and report which ones answer',
    description:
      'Admin only: the response carries Google error messages verbatim, which name the Cloud project. This is the fastest way to confirm whether billing and the individual APIs are enabled.',
  })
  @Roles(ROLES.ADMIN)
  @perMinute(6)
  @Get('diagnostics')
  diagnostics() {
    return this.service.probe();
  }
}
