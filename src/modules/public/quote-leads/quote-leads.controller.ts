import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '@/common/decorators/public.decorator';
import { CreateQuoteLeadDto } from './dto/create-quote-lead.dto';
import type { QuoteLeadReceipt } from './quote-leads.service';
import { QuoteLeadsService } from './quote-leads.service';

@ApiTags('public')
@Controller('public/quote-leads')
export class QuoteLeadsController {
  constructor(private readonly service: QuoteLeadsService) {}

  @ApiOperation({
    summary: 'Receive a public quote lead from the marketing site',
  })
  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body() dto: CreateQuoteLeadDto,
    @Req() request: Request,
    @Headers('user-agent') userAgent?: string,
  ): Promise<QuoteLeadReceipt> {
    return this.service.create(dto, {
      ipAddress: this.ipAddress(request),
      userAgent,
    });
  }

  private ipAddress(request: Request): string | undefined {
    const forwardedFor = request.headers['x-forwarded-for'];

    if (typeof forwardedFor === 'string') {
      return forwardedFor.split(',')[0]?.trim();
    }

    return request.ip;
  }
}
