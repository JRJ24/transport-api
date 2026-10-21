import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Refund } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundQueryDto } from './dto/refund-query.dto';
import { UpdateRefundStatusDto } from './dto/update-refund-status.dto';
import { RefundsService } from './refunds.service';

@ApiTags('refunds')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERATOR)
@Controller('refunds')
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @ApiOperation({ summary: 'List refunds, optionally by status' })
  @Get()
  list(@Query() query: RefundQueryDto): Promise<Refund[]> {
    return this.service.list(query);
  }

  @ApiOperation({
    summary: 'Request a refund of part or all of a payment',
    description:
      'Bounded by what the payment still holds after its pending and completed refunds.',
  })
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRefundDto,
  ): Promise<Refund> {
    return this.service.create(dto, user);
  }

  @ApiOperation({
    summary: 'Record the outcome of a pending refund',
    description:
      'PENDING -> SUCCESS (providerReference required) or FAILED, once. SUCCESS books a REFUND transaction and marks the payment, and a cancelled order, REFUNDED when fully returned.',
  })
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRefundStatusDto,
  ): Promise<Refund> {
    return this.service.updateStatus(id, dto, user);
  }
}
