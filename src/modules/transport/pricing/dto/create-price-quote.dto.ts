import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreatePriceQuoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleCategoryId!: string;

  @ApiProperty({ example: 'Av. Winston Churchill 123' })
  @IsString()
  @Length(5, 180)
  originAddress!: string;

  @ApiProperty({ example: 'Aeropuerto Internacional Las Americas' })
  @IsString()
  @Length(5, 180)
  destinationAddress!: string;

  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Ignored. The server computes the distance from the coordinates; kept so older clients are not rejected.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  distanceKm?: number;

  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Ignored. The server computes the duration from the coordinates; kept so older clients are not rejected.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  estimatedDurationMin?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requireHelper?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  nightService?: boolean;

  @ApiProperty({ example: 18.4861, description: 'Pickup latitude' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  originLatitude!: number;

  @ApiProperty({ example: -69.9312, description: 'Pickup longitude' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  originLongitude!: number;

  @ApiProperty({ example: 18.4301, description: 'Dropoff latitude' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  destinationLatitude!: number;

  @ApiProperty({ example: -69.6689, description: 'Dropoff longitude' })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  destinationLongitude!: number;
}
