import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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

  @ApiProperty({ example: 22.5 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.1)
  distanceKm!: number;

  @ApiProperty({ example: 45 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  estimatedDurationMin!: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requireHelper?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  nightService?: boolean;
}
