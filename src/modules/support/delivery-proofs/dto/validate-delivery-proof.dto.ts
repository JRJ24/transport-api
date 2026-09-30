import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { VALIDATION } from '@generated/prisma/enums';

export class ValidateDeliveryProofDto {
  @ApiProperty({ enum: VALIDATION })
  @IsEnum(VALIDATION)
  validationStatus!: VALIDATION;

  @ApiPropertyOptional({ description: 'Why the proof is rejected' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
