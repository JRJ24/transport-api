import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRefundDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  paymentId!: string;

  @ApiProperty({
    example: 500,
    description: 'At most what the payment still holds after other refunds.',
  })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ example: 'Cancelacion parcial' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
