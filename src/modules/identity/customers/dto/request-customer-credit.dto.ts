import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class RequestCustomerCreditDto {
  @ApiProperty({ example: 50000 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  requestedLimit!: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  creditDays?: number;

  @ApiPropertyOptional({
    example: 'Empresa solicita crédito para viajes recurrentes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
