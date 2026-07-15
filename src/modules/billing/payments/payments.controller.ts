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
import type { Payment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @ApiOperation({ summary: 'List payments' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get()
  list(): Promise<Payment[]> {
    return this.service.list();
  }

  @ApiOperation({ summary: 'Create internal/mock payment' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Post()
  create(@Body() dto: CreatePaymentDto): Promise<Payment> {
    return this.service.create(dto);
  }

  @ApiOperation({ summary: 'Get payment' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Payment | null> {
    return this.service.findOne(id);
  }

  @ApiOperation({ summary: 'Update internal/mock payment status' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ): Promise<Payment> {
    return this.service.updateStatus(id, dto);
  }
}
