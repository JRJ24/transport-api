import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { WebhookEvent } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { Public } from '@/common/decorators/public.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { CreateWebhookEventDto } from './dto/create-webhook-event.dto';
import { WebhooksService } from './webhooks.service';

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

  @ApiOperation({ summary: 'Receive internal/mock webhook' })
  @Public()
  @Post('internal')
  receive(@Body() dto: CreateWebhookEventDto): Promise<WebhookEvent> {
    return this.service.receive(dto);
  }

  @ApiOperation({ summary: 'Receive CardNet payment webhook' })
  @Public()
  @Post('cardnet')
  receiveCardnet(
    @Body() payload: Record<string, unknown>,
    @Headers('x-cardnet-signature') signature?: string,
  ): Promise<WebhookEvent> {
    return this.service.receiveProvider('cardnet', payload, signature);
  }

  @ApiOperation({ summary: 'Receive Azul payment webhook' })
  @Public()
  @Post('azul')
  receiveAzul(
    @Body() payload: Record<string, unknown>,
    @Headers('x-azul-signature') signature?: string,
  ): Promise<WebhookEvent> {
    return this.service.receiveProvider('azul', payload, signature);
  }
}
