import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
  INCIDENT_TYPE,
} from '@generated/prisma/enums';

export class IncidentQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({ enum: INCIDENT_TYPE })
  @IsOptional()
  @IsEnum(INCIDENT_TYPE)
  incidentType?: INCIDENT_TYPE;

  @ApiPropertyOptional({ enum: INCIDENT_SEVERITY })
  @IsOptional()
  @IsEnum(INCIDENT_SEVERITY)
  severity?: INCIDENT_SEVERITY;

  @ApiPropertyOptional({ enum: INCIDENT_STATUS })
  @IsOptional()
  @IsEnum(INCIDENT_STATUS)
  status?: INCIDENT_STATUS;

  @ApiPropertyOptional({
    description: 'Search title, description or order code',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Reported from date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Reported to date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
