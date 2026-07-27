import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RegisterDriverDto {
  @ApiProperty({ example: 'Juan Perez' })
  @IsString()
  @Length(3, 120)
  fullName!: string;

  @ApiProperty({ example: 'conductor@correo.com' })
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

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password!: string;

  @ApiProperty({ example: 'LIC-001-RD' })
  @IsString()
  @Length(3, 60)
  licenseNumber!: string;

  @ApiProperty({ example: '2028-12-31T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  licenseExpiration!: Date;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vehicleCategoryId?: string;

  @ApiPropertyOptional({ example: 'A123456' })
  @IsOptional()
  @IsString()
  @Length(3, 20)
  plateNumber?: string;

  @ApiPropertyOptional({ example: 'Toyota' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  brand?: string;

  @ApiPropertyOptional({ example: 'Hiace' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  model?: string;

  @ApiPropertyOptional({ example: 2024 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1990)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ example: 'Blanco' })
  @IsOptional()
  @IsString()
  @Length(2, 40)
  color?: string;
}
