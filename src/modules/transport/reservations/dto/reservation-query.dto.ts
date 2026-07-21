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
import { RESERVATIONS_STATUS } from '@generated/prisma/enums';

export class ReservationQueryDto {
  @ApiPropertyOptional({ enum: RESERVATIONS_STATUS })
  @IsOptional()
  @IsEnum(RESERVATIONS_STATUS)
  status?: RESERVATIONS_STATUS;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Search order code or customer' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Reserved from date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Reserved to date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
