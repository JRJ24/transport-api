import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class RouteOptimizationDto {
  @ApiProperty({ type: [Object] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsObject({ each: true })
  shipments!: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  vehicles!: Record<string, unknown>[];

  @ApiPropertyOptional({ example: '2026-07-23T12:00:00Z' })
  @IsOptional()
  @IsString()
  globalStartTime?: string;

  @ApiPropertyOptional({ example: '2026-07-23T22:00:00Z' })
  @IsOptional()
  @IsString()
  globalEndTime?: string;
}
