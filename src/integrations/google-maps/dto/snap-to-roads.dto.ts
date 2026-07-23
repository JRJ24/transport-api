import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from './maps-common.dto';

export class SnapToRoadsDto {
  @ApiProperty({ type: [LatLngDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LatLngDto)
  points!: LatLngDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  interpolate?: boolean;
}
