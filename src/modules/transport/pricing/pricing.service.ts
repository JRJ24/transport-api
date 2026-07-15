import { Injectable, NotFoundException } from '@nestjs/common';
import type { PriceQuote, RateCard, RateRule } from '@generated/prisma/client';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreatePriceQuoteDto } from './dto/create-price-quote.dto';
import type { CreateRateCardDto } from './dto/create-rate-card.dto';
import type { CreateRateRuleDto } from './dto/create-rate-rule.dto';
import type { UpdateRateCardDto } from './dto/update-rate-card.dto';

const TAX_RATE = 0.18;
const QUOTE_TTL_MS = 15 * 60_000;

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  listRateCards(): Promise<RateCard[]> {
    return this.prisma.rateCard.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createRateCard(dto: CreateRateCardDto): Promise<RateCard> {
    return this.prisma.rateCard.create({
      data: {
        name: dto.name.trim(),
        description: dto.description.trim(),
        validForm: dto.validFrom,
        validTo: dto.validTo ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  updateRateCard(id: string, dto: UpdateRateCardDto): Promise<RateCard> {
    return this.prisma.rateCard.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && {
          description: dto.description.trim(),
        }),
        ...(dto.validFrom !== undefined && { validForm: dto.validFrom }),
        ...(dto.validTo !== undefined && { validTo: dto.validTo }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  listRateRules(rateCardId: string): Promise<RateRule[]> {
    return this.prisma.rateRule.findMany({
      where: { rateCardId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createRateRule(
    rateCardId: string,
    dto: CreateRateRuleDto,
  ): Promise<RateRule> {
    return this.prisma.rateRule.create({
      data: {
        rateCardId,
        vehicleCategoryId: dto.vehicleCategoryId,
        baseFare: dto.baseFare,
        pricePerKM: dto.pricePerKm,
        pricePerMinute: dto.pricePerMinute,
        minimumFare: dto.minimumFare,
        helperFee: dto.helperFee,
        nightFee: dto.nightFee,
        waitingPricePerMinute: dto.waitingPricePerMinute,
        cancellationFee: dto.cancellationFee,
        createdAt: new Date(),
      },
    });
  }

  async createQuote(
    user: AuthenticatedUser,
    dto: CreatePriceQuoteDto,
  ): Promise<PriceQuote> {
    const customer = await this.prisma.customerProfile.findFirst({
      where: { userId: user.id },
    });

    if (!customer) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    const rule = await this.findActiveRule(dto.vehicleCategoryId);
    const baseFare = Number(rule?.baseFare ?? 250);
    const pricePerKm = Number(rule?.pricePerKM ?? 35);
    const pricePerMinute = Number(rule?.pricePerMinute ?? 5);
    const minimumFare = Number(rule?.minimumFare ?? 350);
    const helperFee = dto.requireHelper ? Number(rule?.helperFee ?? 150) : 0;
    const nightFee = dto.nightService ? Number(rule?.nightFee ?? 100) : 0;

    const variableAmount =
      dto.distanceKm * pricePerKm + dto.estimatedDurationMin * pricePerMinute;
    const baseAmount = Math.max(baseFare + variableAmount, minimumFare);
    const extrasAmount = helperFee + nightFee;
    const demandAmount = 0;
    const weatherAmount = 0;
    const taxAmount = (baseAmount + extrasAmount) * TAX_RATE;
    const totalAmount =
      baseAmount + extrasAmount + demandAmount + weatherAmount + taxAmount;

    return this.prisma.priceQuote.create({
      data: {
        customerId: customer.id,
        vehicleCategoryId: dto.vehicleCategoryId,
        originAddress: dto.originAddress.trim(),
        destinationAddress: dto.destinationAddress.trim(),
        distanceKm: dto.distanceKm,
        estimatedDurationMin: Math.round(dto.estimatedDurationMin),
        baseAmount,
        extrasAmount,
        demandAmount,
        weatherAmount,
        taxAmount,
        totalAmount,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
      },
    });
  }

  getQuote(id: string): Promise<PriceQuote | null> {
    return this.prisma.priceQuote.findUnique({ where: { id } });
  }

  private findActiveRule(vehicleCategoryId: string): Promise<RateRule | null> {
    const now = new Date();

    return this.prisma.rateRule.findFirst({
      where: {
        vehicleCategoryId,
        rateCard: {
          isActive: true,
          validForm: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
