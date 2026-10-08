import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { TRACKING_BATCH_HARD_MAX } from '@/config/tracking.config';
import { TrackingLocationDto } from './tracking-location.dto';

export class BatchLocationsDto {
  @ApiProperty({ type: [TrackingLocationDto] })
  @IsArray()
  @ArrayMinSize(1)
  // Tope absoluto; TRACKING_MAX_BATCH (mas bajo) lo aplica el servicio.
  @ArrayMaxSize(TRACKING_BATCH_HARD_MAX)
  @ValidateNested({ each: true })
  @Type(() => TrackingLocationDto)
  locations!: TrackingLocationDto[];
}
