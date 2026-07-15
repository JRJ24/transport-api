import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { STATUS_ORDERS } from '@generated/prisma/enums';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: STATUS_ORDERS })
  @IsEnum(STATUS_ORDERS)
  status!: STATUS_ORDERS;
}
