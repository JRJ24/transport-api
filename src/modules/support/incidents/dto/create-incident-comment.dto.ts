import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateIncidentCommentDto {
  @ApiProperty({ example: 'Se contacto al cliente.' })
  @IsString()
  @MaxLength(1000)
  comment!: string;
}
