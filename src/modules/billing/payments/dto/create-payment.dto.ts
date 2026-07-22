import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
} from 'class-validator';
import { PAYMENT_METHOD } from '@generated/prisma/enums';

export class CreatePaymentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ enum: PAYMENT_METHOD })
  @IsEnum(PAYMENT_METHOD)
  paymentMethod!: PAYMENT_METHOD;

  @ApiPropertyOptional({ example: 1500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ example: 'DOP' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: ['cardnet', 'azul'] })
  @IsOptional()
  @IsIn(['cardnet', 'azul'])
  provider?: string;

  @ApiPropertyOptional({
    example: 'https://portal.rutard.local/payments/success',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;

  @ApiPropertyOptional({
    example: 'https://portal.rutard.local/payments/cancel',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  cancelUrl?: string;
}
