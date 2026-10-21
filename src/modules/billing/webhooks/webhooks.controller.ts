import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { WebhookEvent } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreateWebhookEventDto } from './dto/create-webhook-event.dto';
import { type WebhookAck, WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @ApiOperation({ summary: 'List received webhooks' })
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get()
  list(): Promise<WebhookEvent[]> {
    return this.service.list();
  }

  @ApiOperation({ summary: 'Record internal/mock webhook (admin only)' })
  @ApiBearerAuth()
  @Roles(ROLES.ADMIN)
  @Post('internal')
  receive(@Body() dto: CreateWebhookEventDto): Promise<WebhookEvent> {
    return this.service.receive(dto);
  }

  @ApiOperation({ summary: 'Receive CardNet payment webhook' })
  @Public()
  @HttpCode(200)
  @Post('cardnet')
  receiveCardnet(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: Record<string, unknown>,
    @Headers('x-cardnet-signature') signature?: string,
  ): Promise<WebhookAck> {
    return this.service.receiveProvider(
      'cardnet',
      payload,
      signature,
      req.rawBody,
    );
  }

  @ApiOperation({ summary: 'Receive Azul payment webhook' })
  @Public()
  @HttpCode(200)
  @Post('azul')
  receiveAzul(
    @Req() req: RawBodyRequest<Request>,
    @Body() payload: Record<string, unknown>,
    @Headers('x-azul-signature') signature?: string,
  ): Promise<WebhookAck> {
    return this.service.receiveProvider(
      'azul',
      payload,
      signature,
      req.rawBody,
    );
  }
}
