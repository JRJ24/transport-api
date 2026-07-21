import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SERVICE_TYPE, STATUS_ORDERS } from '@generated/prisma/enums';

export class OrderQueryDto {
  @ApiPropertyOptional({ enum: STATUS_ORDERS })
  @IsOptional()
  @IsEnum(STATUS_ORDERS)
  status?: STATUS_ORDERS;

  @ApiPropertyOptional({ enum: SERVICE_TYPE })
  @IsOptional()
  @IsEnum(SERVICE_TYPE)
  serviceType?: SERVICE_TYPE;

  @ApiPropertyOptional({
    description: 'Search order code, customer, addresses or driver',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleCategoryId?: string;

  @ApiPropertyOptional({ description: 'Created from date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Created to date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
