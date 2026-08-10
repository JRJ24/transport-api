import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CREDIT_ACCOUNT_STATUS } from '@generated/prisma/enums';

export class UpdateCustomerCreditDto {
  @ApiProperty({ example: 250000 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  creditLimit!: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  creditDays?: number;

  @ApiPropertyOptional({ enum: CREDIT_ACCOUNT_STATUS })
  @IsOptional()
  @IsEnum(CREDIT_ACCOUNT_STATUS)
  status?: CREDIT_ACCOUNT_STATUS;

  @ApiPropertyOptional({ example: 'Cuenta aprobada por operaciones' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
