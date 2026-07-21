import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PROOF_TYPE, VALIDATION } from '@generated/prisma/enums';

export class DeliveryProofQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ enum: PROOF_TYPE })
  @IsOptional()
  @IsEnum(PROOF_TYPE)
  proofType?: PROOF_TYPE;

  @ApiPropertyOptional({ enum: VALIDATION })
  @IsOptional()
  @IsEnum(VALIDATION)
  validationStatus?: VALIDATION;

  @ApiPropertyOptional({
    description: 'Search recipient, document or order code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Captured from date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Captured to date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
