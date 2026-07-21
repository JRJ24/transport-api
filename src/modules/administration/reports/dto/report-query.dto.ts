import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class ReportQueryDto {
  @ApiPropertyOptional({ description: 'Created/reported from date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Created/reported to date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
