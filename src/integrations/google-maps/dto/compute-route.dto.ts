import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsNumber,
  IsObject,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RoutePointDto {
  @ApiProperty({ example: 18.4861 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -69.9312 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class ComputeRouteDto {
  // `@ValidateNested` alone is a no-op on a missing or non-object value, so
  // without these two an empty body passed validation and then crashed with a
  // TypeError deeper in the service.
  @ApiProperty({ type: RoutePointDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RoutePointDto)
  origin!: RoutePointDto;

  @ApiProperty({ type: RoutePointDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RoutePointDto)
  destination!: RoutePointDto;

  @ApiPropertyOptional({ type: [RoutePointDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(23)
  @ValidateNested({ each: true })
  @Type(() => RoutePointDto)
  intermediates?: RoutePointDto[];
}
