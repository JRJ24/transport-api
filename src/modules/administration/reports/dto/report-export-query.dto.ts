import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ReportQueryDto } from './report-query.dto';

export class ReportExportQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'xlsx', 'pdf'] })
  @IsOptional()
  @IsIn(['csv', 'xlsx', 'pdf'])
  format?: 'csv' | 'xlsx' | 'pdf';
}
