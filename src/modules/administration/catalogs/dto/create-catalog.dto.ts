import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCatalogDto {
  @ApiProperty({ example: 'incident-types' })
  @IsString()
  @Length(2, 80)
  groupKey!: string;

  @ApiProperty({ example: 'DELAY' })
  @IsString()
  @Length(2, 80)
  code!: string;

  @ApiProperty({ example: 'Retraso' })
  @IsString()
  @MaxLength(160)
  label!: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
