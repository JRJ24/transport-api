import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ORDER_CANCELLATION } from '@generated/prisma/enums';

export class CancelOrderDto {
  @ApiPropertyOptional({
    enum: ORDER_CANCELLATION,
    description:
      'Staff only: who asked for the cancellation (default ADMIN_CANCELLED; SYSTEM_CANCELLED is refused). Ignored for customers, who are always CUSTOMER_CANCELLED.',
  })
  @IsOptional()
  @IsEnum(ORDER_CANCELLATION)
  cancellationType?: ORDER_CANCELLATION;

  @ApiProperty({ example: 'Cliente solicito cancelar' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
