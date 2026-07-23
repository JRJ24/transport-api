import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class PlaceDetailsDto {
  @ApiProperty({ example: 'places/ChIJ...' })
  @IsString()
  @Length(2, 240)
  placeId!: string;

  @ApiPropertyOptional({ example: 'web-session-uuid' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  sessionToken?: string;
}
