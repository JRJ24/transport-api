import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from './maps-common.dto';

export class PlaceAutocompleteDto {
  @ApiProperty({ example: 'Av. Sarasota 42' })
  @IsString()
  @Length(2, 180)
  input!: string;

  @ApiPropertyOptional({ example: 'web-session-uuid' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  sessionToken?: string;

  @ApiPropertyOptional({ type: LatLngDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LatLngDto)
  locationBias?: LatLngDto;

  @ApiPropertyOptional({ example: 20000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50000)
  radiusMeters?: number;

  @ApiPropertyOptional({ example: ['street_address', 'establishment'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includedPrimaryTypes?: string[];
}
