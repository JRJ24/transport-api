import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class RegisterCheckPaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'Banco Popular' })
  @IsString()
  @MaxLength(120)
  bankName!: string;

  @ApiProperty({ example: '00012345' })
  @IsString()
  @MaxLength(80)
  checkNumber!: string;

  @ApiPropertyOptional({ example: 1500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ example: '2026-08-10T14:30:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  receivedAt?: Date;

  @ApiPropertyOptional({ example: 'Cheque recibido en oficina principal' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
