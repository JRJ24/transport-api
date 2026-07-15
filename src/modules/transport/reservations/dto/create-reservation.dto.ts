import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsUUID } from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: '2026-07-15T16:00:00.000Z' })
  @Type(() => Date)
  @IsDate()
  reservedFor!: Date;
}
