import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PaymentTransaction } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Roles(ROLES.ADMIN, ROLES.OPERATOR)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @ApiOperation({ summary: 'List payment transactions' })
  @Get()
  list(@Query('paymentId') paymentId?: string): Promise<PaymentTransaction[]> {
    return this.service.list(paymentId);
  }

  @ApiOperation({ summary: 'Create internal/mock payment transaction' })
  @Post()
  create(@Body() dto: CreateTransactionDto): Promise<PaymentTransaction> {
    return this.service.create(dto);
  }
}
