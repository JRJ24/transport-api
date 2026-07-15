import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class RescheduleReservationDto {
  @ApiProperty({ example: '2026-07-15T18:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  reservedFor!: Date;
}
