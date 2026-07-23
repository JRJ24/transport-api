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
import type { PriceQuote, RateCard, RateRule } from '@generated/prisma/client';
import { ROLES } from '@generated/prisma/enums';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { CreatePriceQuoteDto } from './dto/create-price-quote.dto';
import { CreateRateCardDto } from './dto/create-rate-card.dto';
import { CreateRateRuleDto } from './dto/create-rate-rule.dto';
import { PreviewManualQuoteDto } from './dto/manual-quote.dto';
import { RateCardQueryDto } from './dto/rate-card-query.dto';
import { UpdateRateCardDto } from './dto/update-rate-card.dto';
import {
  PricingService,
  type ManualQuoteCalculation,
} from './pricing.service';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly service: PricingService) {}

  @ApiOperation({ summary: 'List rate cards' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get('rate-cards')
  listRateCards(@Query() query: RateCardQueryDto): Promise<RateCard[]> {
    return this.service.listRateCards(query);
  }

  @ApiOperation({ summary: 'Create a rate card' })
  @Roles(ROLES.ADMIN)
  @Post('rate-cards')
  createRateCard(@Body() dto: CreateRateCardDto): Promise<RateCard> {
    return this.service.createRateCard(dto);
  }

  @ApiOperation({ summary: 'Update a rate card' })
  @Roles(ROLES.ADMIN)
  @Patch('rate-cards/:id')
  updateRateCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRateCardDto,
  ): Promise<RateCard> {
    return this.service.updateRateCard(id, dto);
  }

  @ApiOperation({ summary: 'List rate rules for a rate card' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Get('rate-cards/:id/rules')
  listRateRules(@Param('id', ParseUUIDPipe) id: string): Promise<RateRule[]> {
    return this.service.listRateRules(id);
  }

  @ApiOperation({ summary: 'Create a rate rule for a rate card' })
  @Roles(ROLES.ADMIN)
  @Post('rate-cards/:id/rules')
  createRateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRateRuleDto,
  ): Promise<RateRule> {
    return this.service.createRateRule(id, dto);
  }

  @ApiOperation({ summary: 'Preview a manual/provisional quote for TMS' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR)
  @Post('manual-quotes/preview')
  previewManualQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PreviewManualQuoteDto,
  ): Promise<ManualQuoteCalculation> {
    return this.service.previewManualQuote(user, dto);
  }

  @ApiOperation({ summary: 'Create an internal/mock price quote' })
  @Roles(ROLES.CUSTOMER)
  @Post('quotes')
  createQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePriceQuoteDto,
  ): Promise<PriceQuote> {
    return this.service.createQuote(user, dto);
  }

  @ApiOperation({ summary: 'Get a quote by id' })
  @Roles(ROLES.ADMIN, ROLES.OPERATOR, ROLES.CUSTOMER)
  @Get('quotes/:id')
  getQuote(@Param('id', ParseUUIDPipe) id: string): Promise<PriceQuote | null> {
    return this.service.getQuote(id);
  }
}
