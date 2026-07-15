import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { NOTIFICATION_TYPE } from '@generated/prisma/enums';

export class CreateNotificationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'Orden actualizada' })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: 'Tu orden fue asignada' })
  @IsString()
  @MaxLength(500)
  message!: string;

  @ApiProperty({ enum: NOTIFICATION_TYPE })
  @IsEnum(NOTIFICATION_TYPE)
  notificationType!: NOTIFICATION_TYPE;

  @ApiPropertyOptional({ example: { orderId: 'uuid' } })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
