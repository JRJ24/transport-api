import {
  All,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Payment } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CreateCardnetSessionDto } from './dto/create-cardnet-session.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import {
  PaymentsService,
  type CreateCardnetSessionResult,
  type CreatePaymentResult,
  type PaymentReceiptResult,
} from './payments.service';

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

  @ApiOperation({ summary: 'Create payment and initialize provider checkout' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<CreatePaymentResult> {
    return this.service.create(dto, user);
  }

  @ApiOperation({ summary: 'Create CardNET payment session for an order' })
  @Roles(ROLES.CUSTOMER)
  @Post('cardnet/sessions')
  createCardnetSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCardnetSessionDto,
    @Req() request: Request,
  ): Promise<CreateCardnetSessionResult> {
    return this.service.createCardnetSession(
      dto.orderId,
      user,
      extractClientIp(request),
    );
  }

  @ApiOperation({ summary: 'Handle CardNET return redirect' })
  @Public()
  @All('cardnet/return')
  async handleCardnetReturn(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const session = extractCardnetSession(body, query);

    if (!session) {
      response.redirect(
        this.service.customerPaymentUrl('/pagos/cardnet/resultado', {
          status: 'error',
        }),
      );
      return;
    }

    try {
      const receipt = await this.service.verifyCardnetPaymentBySession(session);
      response.redirect(
        this.service.customerPaymentUrl('/pagos/cardnet/resultado', {
          status: receipt.status,
          orderId: receipt.orderId,
          paymentId: receipt.paymentId,
        }),
      );
    } catch {
      response.redirect(
        this.service.customerPaymentUrl('/pagos/cardnet/resultado', {
          status: 'error',
          session,
        }),
      );
    }
  }

  @ApiOperation({ summary: 'Handle CardNET cancel redirect' })
  @Public()
  @All('cardnet/cancel')
  async handleCardnetCancel(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const session = extractCardnetSession(body, query);
    const receipt = session
      ? await this.service.cancelCardnetPaymentBySession(session)
      : null;

    response.redirect(
      this.service.customerPaymentUrl('/pagos/cardnet/cancelado', {
        status: receipt?.status ?? 'CANCELLED',
        orderId: receipt?.orderId,
        paymentId: receipt?.paymentId,
      }),
    );
  }

  @ApiOperation({ summary: 'Verify a CardNET payment result' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Post(':id/verify')
  verifyCardnetPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentReceiptResult> {
    return this.service.verifyCardnetPayment(id, user);
  }

  @ApiOperation({ summary: 'Get payment receipt' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Get(':id/receipt')
  getReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentReceiptResult> {
    return this.service.getReceipt(id, user);
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

function extractClientIp(request: Request): string {
  const forwardedFor = request.headers['x-forwarded-for'];

  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim();
  }

  return request.ip ?? request.socket.remoteAddress ?? '127.0.0.1';
}

function extractCardnetSession(
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
): string | undefined {
  for (const value of [
    body?.SESSION,
    body?.Session,
    query?.SESSION,
    query?.Session,
  ]) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}
