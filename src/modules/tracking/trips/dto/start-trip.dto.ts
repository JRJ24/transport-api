import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StartTripDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  driverId!: string;
}
