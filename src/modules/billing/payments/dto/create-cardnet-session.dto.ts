import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateCardnetSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;
}
