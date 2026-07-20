import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ format: 'uuid', description: 'Order to start tracking for' })
  @IsUUID()
  orderId!: string;
}
