import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PAYMENT_STATUS } from '@generated/prisma/enums';

export class UpdatePaymentStatusDto {
  @ApiPropertyOptional({ enum: PAYMENT_STATUS })
  @IsEnum(PAYMENT_STATUS)
  status!: PAYMENT_STATUS;

  @ApiPropertyOptional({ example: 'internal-paid-123' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  providerReference?: string;
}
