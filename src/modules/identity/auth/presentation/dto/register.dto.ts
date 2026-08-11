import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DOCUMENT_TYPE, TYPE_CUSTOMER } from '@generated/prisma/enums';
import { CLIENT_PLATFORMS, type ClientPlatform } from './login.dto';

export class RegisterDto {
  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  @Length(3, 120)
  fullName!: string;

  @ApiProperty({ example: 'usuario@correo.com' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : String(value),
  )
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '+18095551234' })
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, {
    message: 'phone must be a valid phone number (10-15 digits)',
  })
  phone!: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 72,
    description: 'At least 8 characters, with letters and numbers',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;

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

  @ApiPropertyOptional({ enum: CLIENT_PLATFORMS })
  @IsOptional()
  @IsIn(CLIENT_PLATFORMS)
  platform?: ClientPlatform;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}
