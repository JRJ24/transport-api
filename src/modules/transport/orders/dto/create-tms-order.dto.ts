import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SERVICE_TYPE } from '@generated/prisma/enums';
import { CreateOrderItemDto, CreateOrderStopDto } from './create-order.dto';

export class CreateTmsOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  quoteId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleCategoryId!: string;

  @ApiProperty({ enum: SERVICE_TYPE })
  @IsEnum(SERVICE_TYPE)
  serviceType!: SERVICE_TYPE;

  @ApiPropertyOptional({ example: '2026-07-15T16:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduleAt?: Date;

  @ApiProperty({ example: 12.4 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  distanceKm!: number;

  @ApiProperty({ example: 32 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDurationMin!: number;

  @ApiProperty({ example: 1850 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  totalAmount!: number;

  @ApiPropertyOptional({ example: 'Creada desde torre de control' })
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
