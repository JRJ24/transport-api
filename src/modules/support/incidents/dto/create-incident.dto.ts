import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { INCIDENT_SEVERITY, INCIDENT_TYPE } from '@generated/prisma/enums';

export class CreateIncidentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ enum: INCIDENT_TYPE })
  @IsEnum(INCIDENT_TYPE)
  incidentType!: INCIDENT_TYPE;

  @ApiProperty({ enum: INCIDENT_SEVERITY })
  @IsEnum(INCIDENT_SEVERITY)
  severity!: INCIDENT_SEVERITY;

  @ApiProperty({ example: 'Retraso en recogida' })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiProperty({ example: 'El conductor reporta trafico intenso' })
  @IsString()
  @MaxLength(1000)
  description!: string;

  @ApiProperty({ example: 18.4861 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -69.9312 })
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;
}
