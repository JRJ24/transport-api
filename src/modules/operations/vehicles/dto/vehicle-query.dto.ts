import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { STATUS_VEHICLE } from '@generated/prisma/enums';

export class VehicleQueryDto {
  @ApiPropertyOptional({ enum: STATUS_VEHICLE })
  @IsOptional()
  @IsEnum(STATUS_VEHICLE)
  status?: STATUS_VEHICLE;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional({
    description: 'Search plate, brand, model, color or category',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
