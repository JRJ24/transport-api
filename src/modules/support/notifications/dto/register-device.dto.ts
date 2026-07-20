import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DEVICE_PLATFORM } from '@generated/prisma/enums';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM/APNs registration token' })
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token!: string;

  @ApiProperty({ enum: DEVICE_PLATFORM })
  @IsEnum(DEVICE_PLATFORM)
  platform!: DEVICE_PLATFORM;

  @ApiProperty({ description: 'Stable per-install id' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  installationId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;
}
