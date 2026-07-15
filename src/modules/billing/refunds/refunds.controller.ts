import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Refund } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreateRefundDto } from './dto/create-refund.dto';
import { UpdateRefundStatusDto } from './dto/update-refund-status.dto';
import { RefundsService } from './refunds.service';

@ApiTags('refunds')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERATOR)
@Controller('refunds')
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @ApiOperation({ summary: 'List refunds' })
  @Get()
  list(): Promise<Refund[]> {
    return this.service.list();
  }

  @ApiOperation({ summary: 'Create internal/mock refund' })
  @Post()
  create(@Body() dto: CreateRefundDto): Promise<Refund> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Update refund status' })
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRefundStatusDto,
  ): Promise<Refund> {
    return this.service.updateStatus(id, dto);
  }
}
