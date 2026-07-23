import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

export class LatLngDto {
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
