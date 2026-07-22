import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import type { Response } from 'express';
import { Roles } from '@/common/decorators/roles.decorator';
import { ReportExportQueryDto } from './dto/report-export-query.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERATOR)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @ApiOperation({ summary: 'Get operations report' })
  @Get('operations')
  operations(@Query() query: ReportQueryDto) {
    return this.service.operations(query);
  }

  @ApiOperation({ summary: 'Get billing report' })
  @Get('billing')
  billing(@Query() query: ReportQueryDto) {
    return this.service.billing(query);
  }

  @ApiOperation({ summary: 'Export operations or billing report' })
  @Get(':type/export')
  async export(
    @Param('type') type: 'operations' | 'billing',
    @Query() query: ReportExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Buffer> {
    const file = await this.service.export(type, query.format ?? 'csv', query);
    response.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': file.content.length,
    });
    return file.content;
  }
}
