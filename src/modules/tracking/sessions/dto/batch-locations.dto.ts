import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { TrackingLocationDto } from './tracking-location.dto';

export class BatchLocationsDto {
  @ApiProperty({ type: [TrackingLocationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TrackingLocationDto)
  locations!: TrackingLocationDto[];
}
