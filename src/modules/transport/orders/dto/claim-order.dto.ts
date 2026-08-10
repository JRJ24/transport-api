import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ClaimOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleId!: string;
}
