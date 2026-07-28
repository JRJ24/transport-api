import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const serviceValues = [
  'mensajeria-express',
  'distribucion-local',
  'carga-nacional-seca',
  'cadena-frio',
  'otro',
] as const;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class CreateQuoteLeadDto {
  @ApiProperty({ example: 'Maria Gonzalez' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(3, 120)
  fullName!: string;

  @ApiPropertyOptional({ example: 'Farmacia Central' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @ApiProperty({ example: '+18095551234' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(/^\+?[0-9\s().-]{7,25}$/, {
    message: 'phone must be a valid phone number',
  })
  phone!: string;

  @ApiPropertyOptional({ example: 'maria@empresa.com' })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0
      ? value.toLowerCase().trim()
      : undefined,
  )
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ enum: serviceValues })
  @Transform(({ value }) => trimString(value))
  @IsIn(serviceValues)
  service!: (typeof serviceValues)[number];

  @ApiProperty({ example: 'Santo Domingo' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(2, 180)
  origin!: string;

  @ApiProperty({ example: 'Santiago' })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Length(2, 180)
  destination!: string;

  @ApiPropertyOptional({
    example: 'Cajas de medicamentos, 200 kg, dos veces por semana.',
  })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(1200)
  description?: string;

  @ApiProperty({ example: true })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @Equals(true, { message: 'consentWhatsapp must be accepted' })
  consentWhatsapp!: boolean;

  @ApiPropertyOptional({ example: 'landing' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  source?: string;

  @ApiPropertyOptional({ example: 'https://larutard.com.do/' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  landingUrl?: string;

  @ApiPropertyOptional({ example: 'google' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmSource?: string;

  @ApiPropertyOptional({ example: 'cpc' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  utmMedium?: string;

  @ApiPropertyOptional({ example: 'lanzamiento' })
  @Transform(({ value }) => optionalTrimmedString(value))
  @IsOptional()
  @IsString()
  @MaxLength(160)
  utmCampaign?: string;
}
