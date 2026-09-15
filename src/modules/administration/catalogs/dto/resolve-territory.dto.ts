import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class ResolveTerritoryDto {
  @ApiPropertyOptional({ example: 'Santo Domingo' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  province?: string;

  @ApiPropertyOptional({ example: 'Santo Domingo Este' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  municipality?: string;
}
