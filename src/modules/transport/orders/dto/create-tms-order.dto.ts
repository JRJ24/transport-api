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
import { CreateOrderManualQuoteDto } from '@/modules/transport/pricing/dto/manual-quote.dto';
import { CreateOrderItemDto, CreateOrderStopDto } from './create-order.dto';

export enum TMS_ORDER_SUBMIT_MODE {
  DRAFT = 'DRAFT',
  CREATE_AND_QUOTE = 'CREATE_AND_QUOTE',
}

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

  @ApiPropertyOptional({ enum: TMS_ORDER_SUBMIT_MODE })
  @IsOptional()
  @IsEnum(TMS_ORDER_SUBMIT_MODE)
  submitMode?: TMS_ORDER_SUBMIT_MODE;

  @ApiPropertyOptional({ example: '2026-07-15T16:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduleAt?: Date;

  @ApiPropertyOptional({ example: 12.4 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  distanceKm?: number;

  @ApiPropertyOptional({ example: 32 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDurationMin?: number;

  @ApiPropertyOptional({ example: 1850 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  totalAmount?: number;

  @ApiPropertyOptional({ example: 'Creada desde torre de control' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ type: CreateOrderManualQuoteDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOrderManualQuoteDto)
  manualQuote?: CreateOrderManualQuoteDto;

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
