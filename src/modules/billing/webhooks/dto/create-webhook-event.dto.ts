import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString, MaxLength } from 'class-validator';

export class CreateWebhookEventDto {
  @ApiProperty({ example: 'payment.paid' })
  @IsString()
  @MaxLength(120)
  eventType!: string;

  @ApiProperty({ example: 'evt_internal_123' })
  @IsString()
  @MaxLength(160)
  externalEventId!: string;

  @ApiProperty({ example: { paymentId: 'uuid' } })
  @IsObject()
  payload!: Record<string, unknown>;
}
