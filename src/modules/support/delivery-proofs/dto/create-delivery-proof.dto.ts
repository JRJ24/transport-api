import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PROOF_TYPE } from '@generated/prisma/enums';

export class CreateDeliveryProofDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ enum: PROOF_TYPE })
  @IsEnum(PROOF_TYPE)
  proofType!: PROOF_TYPE;

  @ApiProperty({ example: 'Maria Perez' })
  @IsString()
  @MaxLength(120)
  recipientName!: string;

  @ApiProperty({ example: '00112345678' })
  @IsString()
  @MaxLength(60)
  recipientDocument!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({ example: 18.4861 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -69.9312 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;
}
