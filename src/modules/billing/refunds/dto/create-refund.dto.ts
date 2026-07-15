import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateRefundDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  paymentId!: string;

  @ApiProperty({ example: 500 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  amount!: number;

  @ApiProperty({ example: 'Cancelacion parcial' })
  @IsString()
  @MaxLength(300)
  reason!: string;
}
