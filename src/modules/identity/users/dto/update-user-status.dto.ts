import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { STATUS_ACCOUNT } from '@generated/prisma/enums';

export class UpdateUserStatusDto {
  @ApiProperty({ enum: STATUS_ACCOUNT })
  @IsEnum(STATUS_ACCOUNT)
  status!: STATUS_ACCOUNT;
}
