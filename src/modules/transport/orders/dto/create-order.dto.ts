import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SERVICE_TYPE, STOP_TYPE } from '@generated/prisma/enums';

export class CreateOrderStopDto {
  @ApiProperty({ enum: STOP_TYPE })
  @IsEnum(STOP_TYPE)
  stopType!: STOP_TYPE;

  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence!: number;

  @ApiProperty({ example: 'Juan Perez' })
  @IsString()
  @Length(2, 120)
  contactName!: string;

  @ApiProperty({ example: '+18095551234' })
  @IsString()
  @Length(8, 20)
  contactPhone!: string;

  @ApiProperty({ example: 'Av. Winston Churchill 123' })
  @IsString()
  @Length(5, 180)
  addressLine!: string;

  @ApiProperty({ example: 'Santo Domingo' })
  @IsString()
  @MaxLength(80)
  city!: string;

  @ApiProperty({ example: 'Distrito Nacional' })
  @IsString()
  @MaxLength(80)
  province!: string;

  @ApiProperty({ example: 18.4861 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  latitude!: number;

  @ApiProperty({ example: -69.9312 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  longitude!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  instructions?: string;
}

export class CreateOrderItemDto {
  @ApiProperty({ example: 'Caja mediana' })
  @IsString()
  @Length(2, 180)
  description!: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 12.5 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  weightKg!: number;

  @ApiPropertyOptional({ example: 0.4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  volumeM3?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  declaredValue?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  fragile?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requireHelper?: boolean;
}

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  quoteId!: string;

  @ApiProperty({ enum: SERVICE_TYPE })
  @IsEnum(SERVICE_TYPE)
  serviceType!: SERVICE_TYPE;

  @ApiPropertyOptional({ example: '2026-07-15T16:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduleAt?: Date;

  @ApiPropertyOptional({ example: 'Llamar al llegar' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ type: [CreateOrderStopDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderStopDto)
  stops!: CreateOrderStopDto[];

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
