import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';
import { SYSTEM_VALUE } from '@generated/prisma/enums';

export class UpsertParameterDto {
  @ApiProperty({ example: 'tax.rate' })
  @IsString()
  @MaxLength(120)
  key!: string;

  @ApiProperty({ example: '0.18' })
  @IsString()
  value!: string;

  @ApiProperty({ enum: SYSTEM_VALUE })
  @IsEnum(SYSTEM_VALUE)
  valueType!: SYSTEM_VALUE;

  @ApiProperty({ example: 'ITBIS aplicado a cotizaciones' })
  @IsString()
  @MaxLength(300)
  description!: string;
}
