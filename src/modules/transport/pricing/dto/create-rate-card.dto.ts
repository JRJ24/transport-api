import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateRateCardDto {
  @ApiProperty({ example: 'Tarifa base Santo Domingo' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ example: 'Tarifa interna V1 para calculos mock' })
  @IsString()
  @Length(2, 240)
  description!: string;

  @ApiProperty({ example: '2026-07-15T00:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  validFrom!: Date;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Higher wins when several active cards price the same category',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;
}
