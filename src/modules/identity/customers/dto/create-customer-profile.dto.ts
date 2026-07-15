import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { DOCUMENT_TYPE, TYPE_CUSTOMER } from '@generated/prisma/enums';

export class CreateCustomerProfileDto {
  @ApiProperty({ enum: TYPE_CUSTOMER })
  @IsEnum(TYPE_CUSTOMER)
  customerType!: TYPE_CUSTOMER;

  @ApiProperty({ enum: DOCUMENT_TYPE })
  @IsEnum(DOCUMENT_TYPE)
  documentType!: DOCUMENT_TYPE;

  @ApiProperty({ example: '00112345678' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 40)
  documentNumber!: string;

  @ApiPropertyOptional({ example: 'Acme Logistics SRL' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyName?: string;

  @ApiPropertyOptional({ example: 'billing@acme.test' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  billingEmail?: string;
}
