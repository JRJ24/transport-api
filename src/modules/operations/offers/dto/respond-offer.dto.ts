import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectOfferDto {
  @ApiPropertyOptional({ example: 'Muy lejos de mi zona' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
