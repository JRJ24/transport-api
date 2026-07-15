import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, Length, Max, Min } from 'class-validator';

export class EstimateRouteDto {
  @ApiProperty({ example: 'Origen' })
  @IsString()
  @Length(2, 180)
  originAddress!: string;

  @ApiProperty({ example: 18.4861 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  originLatitude!: number;

  @ApiProperty({ example: -69.9312 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  originLongitude!: number;

  @ApiProperty({ example: 'Destino' })
  @IsString()
  @Length(2, 180)
  destinationAddress!: string;

  @ApiProperty({ example: 18.4301 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  destinationLatitude!: number;

  @ApiProperty({ example: -69.6689 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  destinationLongitude!: number;
}
