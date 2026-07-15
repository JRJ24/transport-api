import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const CLIENT_PLATFORMS = ['ios', 'android', 'web'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export class LoginDto {
  @ApiProperty({ example: 'usuario@correo.com' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : String(value),
  )
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({
    enum: CLIENT_PLATFORMS,
    description:
      'Client platform; determines the refresh-token lifetime (web: shorter, mobile: longer)',
  })
  @IsOptional()
  @IsIn(CLIENT_PLATFORMS)
  platform?: ClientPlatform;

  @ApiPropertyOptional({ description: 'Stable device identifier' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string;

  @ApiPropertyOptional({ example: 'iPhone 15 de Juan' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}
