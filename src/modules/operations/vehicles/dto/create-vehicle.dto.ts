import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { STATUS_VEHICLE } from '@generated/prisma/enums';

export class CreateVehicleDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  driverId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: 'A123456' })
  @IsString()
  @Length(3, 20)
  plateNumber!: string;

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @Length(2, 60)
  brand!: string;

  @ApiProperty({ example: 'Hiace' })
  @IsString()
  @Length(1, 60)
  model!: string;

  @ApiProperty({ example: 2024 })
  @Type(() => Number)
  @IsInt()
  @Min(1990)
  @Max(2100)
  year!: number;

  @ApiProperty({ example: 'Blanco' })
  @IsString()
  @Length(2, 40)
  color!: string;

  @ApiPropertyOptional({ enum: STATUS_VEHICLE })
  @IsOptional()
  @IsEnum(STATUS_VEHICLE)
  status?: STATUS_VEHICLE;
}
