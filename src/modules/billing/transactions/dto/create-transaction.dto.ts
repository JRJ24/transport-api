import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import {
  PAYMENT_TRANSACTIONS_TYPE,
  PAYMENTS_TRANSACTIONS_STATUS,
} from '@generated/prisma/enums';

export class CreateTransactionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  paymentId!: string;

  @ApiProperty({ enum: PAYMENT_TRANSACTIONS_TYPE })
  @IsEnum(PAYMENT_TRANSACTIONS_TYPE)
  transactionType!: PAYMENT_TRANSACTIONS_TYPE;

  @ApiProperty({ example: 1500 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: PAYMENTS_TRANSACTIONS_STATUS })
  @IsEnum(PAYMENTS_TRANSACTIONS_STATUS)
  status!: PAYMENTS_TRANSACTIONS_STATUS;

  @ApiPropertyOptional({ example: { provider: 'internal-mock' } })
  @IsOptional()
  @IsObject()
  providerResponse?: Record<string, unknown>;
}
