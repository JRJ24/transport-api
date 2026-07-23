import { Body, Controller, Post } from '@nestjs/common';
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

@ApiTags('maps')
@ApiBearerAuth()
@Controller('maps')
export class GoogleMapsController {
  constructor(private readonly service: GoogleMapsPlatformService) {}

  @ApiOperation({ summary: 'Autocomplete places and addresses' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post('places/autocomplete')
  autocompletePlaces(@Body() dto: PlaceAutocompleteDto) {
    return this.service.autocompletePlaces(dto);
  }

  @ApiOperation({ summary: 'Get place details' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post('places/details')
  getPlaceDetails(@Body() dto: PlaceDetailsDto) {
    return this.service.getPlaceDetails(dto);
  }

  @ApiOperation({ summary: 'Convert an address into coordinates' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post('geocode')
  geocode(@Body() dto: GeocodeDto) {
    return this.service.geocode(dto);
  }

  @ApiOperation({ summary: 'Convert GPS coordinates into a readable address' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post('reverse-geocode')
  reverseGeocode(@Body() dto: ReverseGeocodeDto) {
    return this.service.reverseGeocode(dto);
  }

  @ApiOperation({ summary: 'Validate and normalize a postal address' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER, ROLES.DRIVER)
  @Post('address-validation')
  validateAddress(@Body() dto: AddressValidationDto) {
    return this.service.validateAddress(dto);
  }

  @ApiOperation({ summary: 'Snap GPS points to roads' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.DRIVER)
  @Post('roads/snap')
  snapToRoads(@Body() dto: SnapToRoadsDto) {
    return this.service.snapToRoads(dto);
  }

  @ApiOperation({ summary: 'Optimize multiple shipments and vehicles' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Post('route-optimization')
  optimizeRoutes(@Body() dto: RouteOptimizationDto) {
    return this.service.optimizeRoutes(dto);
  }
}
