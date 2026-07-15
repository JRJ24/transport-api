import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { STATUS_ORDERS } from '@generated/prisma/enums';

export class OrderQueryDto {
  @ApiPropertyOptional({ enum: STATUS_ORDERS })
  @IsOptional()
  @IsEnum(STATUS_ORDERS)
  status?: STATUS_ORDERS;
}
