import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { VALIDATION } from '@generated/prisma/enums';

export class ValidateDeliveryProofDto {
  @ApiProperty({ enum: VALIDATION })
  @IsEnum(VALIDATION)
  validationStatus!: VALIDATION;
}
