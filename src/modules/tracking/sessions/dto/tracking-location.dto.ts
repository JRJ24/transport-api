import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A single GPS fix. `sessionId`/`orderId`/`driverId`/`vehicleId` are NOT trusted
 * from the client — they are derived server-side from the authenticated session.
 * `clientId` provides idempotency; `sequence` preserves ordering.
 */
export class TrackingLocationDto {
  @ApiProperty({ example: 18.4861 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -69.9312 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ example: 8.5, description: 'Accuracy in meters' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  accuracyMeters?: number;

  @ApiPropertyOptional({ example: 120.0, description: 'Altitude in meters' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  altitudeMeters?: number;

  @ApiPropertyOptional({ example: 12.4, description: 'Speed in meters/second' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  speedMps?: number;

  @ApiPropertyOptional({
    example: 90,
    description: 'Heading in degrees (0-360)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiPropertyOptional({ example: 80 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  batteryLevel?: number;

  @ApiProperty({ example: '2026-07-20T16:00:00.000Z' })
  @IsISO8601()
  recordedAt!: string;

  @ApiProperty({
    example: 42,
    description: 'Monotonic sequence within the session',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sequence!: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isMocked?: boolean;

  @ApiPropertyOptional({
    description: 'Client-generated id for idempotent delivery',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;
}
