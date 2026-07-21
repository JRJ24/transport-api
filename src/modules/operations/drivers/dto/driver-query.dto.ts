import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';

export class DriverQueryDto {
  @ApiPropertyOptional({ enum: STATUS_DRIVER })
  @IsOptional()
  @IsEnum(STATUS_DRIVER)
  availabilityStatus?: STATUS_DRIVER;

  @ApiPropertyOptional({ enum: VERIFICATION_STATUS })
  @IsOptional()
  @IsEnum(VERIFICATION_STATUS)
  verificationStatus?: VERIFICATION_STATUS;

  @ApiPropertyOptional({ description: 'Search name, email, phone or license' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
