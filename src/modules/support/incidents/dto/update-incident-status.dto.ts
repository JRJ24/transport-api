import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { INCIDENT_STATUS } from '@generated/prisma/enums';

export class UpdateIncidentStatusDto {
  @ApiProperty({ enum: INCIDENT_STATUS })
  @IsEnum(INCIDENT_STATUS)
  status!: INCIDENT_STATUS;
}
