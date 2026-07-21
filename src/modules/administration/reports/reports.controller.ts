import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
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
}
