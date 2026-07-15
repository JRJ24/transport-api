import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PAYMENTS_REFUND_STATUS } from '@generated/prisma/enums';

export class UpdateRefundStatusDto {
  @ApiPropertyOptional({ enum: PAYMENTS_REFUND_STATUS })
  @IsEnum(PAYMENTS_REFUND_STATUS)
  status!: PAYMENTS_REFUND_STATUS;

  @ApiPropertyOptional({ example: 'internal-refund-123' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  providerReference?: string;
}
