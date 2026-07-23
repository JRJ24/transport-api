import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class AddressValidationDto {
  @ApiProperty({ example: ['Av. Sarasota 42, Bella Vista'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  addressLines!: string[];

  @ApiPropertyOptional({ example: 'DO' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  regionCode?: string;

  @ApiPropertyOptional({ example: 'Santo Domingo' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  locality?: string;

  @ApiPropertyOptional({ example: 'Distrito Nacional' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  administrativeArea?: string;

  @ApiPropertyOptional({ example: '10112' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;
}
