import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { STATUS_DRIVER } from '@generated/prisma/enums';

export class UpdateDriverStatusDto {
  @ApiProperty({ enum: STATUS_DRIVER })
  @IsEnum(STATUS_DRIVER)
  availabilityStatus!: STATUS_DRIVER;
}
