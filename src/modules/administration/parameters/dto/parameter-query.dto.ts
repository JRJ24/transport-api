import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SYSTEM_VALUE } from '@generated/prisma/enums';

export class ParameterQueryDto {
  @ApiPropertyOptional({ enum: SYSTEM_VALUE })
  @IsOptional()
  @IsEnum(SYSTEM_VALUE)
  valueType?: SYSTEM_VALUE;

  @ApiPropertyOptional({ description: 'Search key, value or description' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
