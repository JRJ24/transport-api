import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';
import { ORDER_CANCELLATION } from '@generated/prisma/enums';

export class CancelOrderDto {
  @ApiProperty({ enum: ORDER_CANCELLATION })
  @IsEnum(ORDER_CANCELLATION)
  cancellationType!: ORDER_CANCELLATION;

  @ApiProperty({ example: 'Cliente solicito cancelar' })
  @IsString()
  @MaxLength(300)
  reason!: string;
}
