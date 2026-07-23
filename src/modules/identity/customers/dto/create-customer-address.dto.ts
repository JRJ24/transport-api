import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCustomerAddressDto {
  @ApiProperty({ example: 'Casa' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 80)
  label!: string;

  @ApiProperty({ example: 'Av. Winston Churchill 123' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(5, 180)
  addressLine!: string;

  @ApiProperty({ example: 'Santo Domingo' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(80)
  city!: string;

  @ApiProperty({ example: 'Distrito Nacional' })
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(80)
  province!: string;

  @ApiPropertyOptional({ example: 18.4861 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: -69.9312 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
