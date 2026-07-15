import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { STATUS_DRIVER, VERIFICATION_STATUS } from '@generated/prisma/enums';

export class CreateDriverDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'DRV-123456' })
  @IsString()
  @Length(3, 60)
  licenseNumber!: string;

  @ApiProperty({ example: '2028-12-31T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  licenseExpiration!: Date;

  @ApiPropertyOptional({ enum: STATUS_DRIVER })
  @IsOptional()
  @IsEnum(STATUS_DRIVER)
  availabilityStatus?: STATUS_DRIVER;

  @ApiPropertyOptional({ enum: VERIFICATION_STATUS })
  @IsOptional()
  @IsEnum(VERIFICATION_STATUS)
  verificationStatus?: VERIFICATION_STATUS;
}
