import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class ManualQuoteChargesDto {
  @ApiProperty({ example: 12.5 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.1)
  distanceKm!: number;

  @ApiPropertyOptional({ example: 35 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  estimatedDurationMin?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  helperRequired?: boolean;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  tollAmount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  weightSurcharge?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  volumeSurcharge?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  otherCharges?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  manualAdjustmentAmount?: number;

  @ApiPropertyOptional({ example: 'Ajuste autorizado por gerencia' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  adjustmentReason?: string;
}

export class PreviewManualQuoteDto extends ManualQuoteChargesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

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
}

export class CreateOrderManualQuoteDto extends ManualQuoteChargesDto {}
