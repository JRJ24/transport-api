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

export class CreateTmsCustomerDto {
  @ApiProperty({ example: 'Juan Perez' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @ApiProperty({ example: 'juan.perez@example.com' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @ApiProperty({ example: '+18095551234' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(8, 30)
  phone!: string;

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

  @ApiPropertyOptional({ example: 'billing@example.com' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  billingEmail?: string;
}
