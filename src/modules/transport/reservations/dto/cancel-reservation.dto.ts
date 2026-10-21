import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CancelReservationDto {
  @ApiPropertyOptional({
    example: 'Cliente pospuso la mudanza',
    description:
      'Recorded on the order cancellation and on its refund, if any.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason?: string;
}
