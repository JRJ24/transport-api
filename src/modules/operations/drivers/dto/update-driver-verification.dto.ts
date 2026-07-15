import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { VERIFICATION_STATUS } from '@generated/prisma/enums';

export class UpdateDriverVerificationDto {
  @ApiProperty({ enum: VERIFICATION_STATUS })
  @IsEnum(VERIFICATION_STATUS)
  verificationStatus!: VERIFICATION_STATUS;
}
