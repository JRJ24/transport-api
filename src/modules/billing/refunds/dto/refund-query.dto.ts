import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PAYMENTS_REFUND_STATUS } from '@generated/prisma/enums';

export class RefundQueryDto {
  @ApiPropertyOptional({ enum: PAYMENTS_REFUND_STATUS })
  @IsOptional()
  @IsEnum(PAYMENTS_REFUND_STATUS)
  status?: PAYMENTS_REFUND_STATUS;
}
