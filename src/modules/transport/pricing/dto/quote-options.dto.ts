import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Input for the category cards: a route plus whatever the customer has told us
 * about the load so far. Everything about the load is optional because the
 * cards appear as soon as there is a route, and get more accurate as the
 * customer fills the load in.
 */
export class QuoteOptionsDto {
  @ApiProperty({ example: 13.2 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  distanceKm!: number;

  @ApiProperty({ example: 28 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  estimatedDurationMin!: number;

  @ApiPropertyOptional({ example: 12.5, description: 'Per unit, not total.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  weightKg?: number;

  @ApiPropertyOptional({ example: 0.4, description: 'Per unit, not total.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  volumeM3?: number;

  @ApiPropertyOptional({ example: 2, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requireHelper?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  nightService?: boolean;
}
