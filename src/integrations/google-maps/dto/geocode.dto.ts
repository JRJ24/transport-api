import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class GeocodeDto {
  @ApiProperty({ example: 'Av. Sarasota 42, Bella Vista, Santo Domingo' })
  @IsString()
  @Length(5, 240)
  address!: string;
}
