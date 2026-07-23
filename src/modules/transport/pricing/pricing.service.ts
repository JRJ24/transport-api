import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  PriceQuote,
  Prisma,
  RateCard,
  RateRule,
} from '@generated/prisma/client';
import { QUOTE_SOURCE, QUOTE_STATUS, ROLES } from '@generated/prisma/enums';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';
import type { CreatePriceQuoteDto } from './dto/create-price-quote.dto';
import type { PreviewManualQuoteDto } from './dto/manual-quote.dto';
import type { CreateRateCardDto } from './dto/create-rate-card.dto';
import type { CreateRateRuleDto } from './dto/create-rate-rule.dto';
import type { RateCardQueryDto } from './dto/rate-card-query.dto';
import type { UpdateRateCardDto } from './dto/update-rate-card.dto';

const TAX_RATE = 0.18;
const QUOTE_TTL_MS = 15 * 60_000;
const MANUAL_QUOTE_TTL_MS = 24 * 60 * 60_000;

type QuoteDbClient = PrismaService | Prisma.TransactionClient;

export interface ManualQuoteInput {
  customerId: string;
  orderId?: string | null;
  vehicleCategoryId: string;
  originAddress: string;
  destinationAddress: string;
  distanceKm: number;
  estimatedDurationMin?: number;
  helperRequired?: boolean;
  tollAmount?: number;
  weightSurcharge?: number;
  volumeSurcharge?: number;
  otherCharges?: number;
  discountAmount?: number;
  manualAdjustmentAmount?: number;
  adjustmentReason?: string;
}

export interface ManualQuoteCalculation {
  quoteSource: QUOTE_SOURCE;
  quoteStatus: QUOTE_STATUS;
  distanceKm: number;
  estimatedDurationMin: number;
  baseAmount: number;
  extrasAmount: number;
  demandAmount: number;
  weatherAmount: number;
  taxAmount: number;
  totalAmount: number;
  manualAdjustmentAmount: number;
  adjustmentReason?: string;
  breakdown: Prisma.InputJsonObject;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  listRateCards(query: RateCardQueryDto): Promise<RateCard[]> {
    const where: Prisma.RateCardWhereInput = {
      ...(query.isActive !== undefined && {
        isActive: query.isActive === 'true',
      }),
      ...((query.from || query.to) && {
        AND: [
          ...(query.to ? [{ validForm: { lte: query.to } }] : []),
          ...(query.from
            ? [{ OR: [{ validTo: null }, { validTo: { gte: query.from } }] }]
            : []),
        ],
      }),
    };

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.rateCard.findMany({
      where,
      include: { rateRules: { orderBy: { createdAt: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
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

    if (!rule) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'No active rate rule found for the selected vehicle category',
      });
    }

    const baseFare = Number(rule.baseFare);
    const pricePerKm = Number(rule.pricePerKM);
    const pricePerMinute = Number(rule.pricePerMinute);
    const minimumFare = Number(rule.minimumFare);
    const helperFee = dto.requireHelper ? Number(rule.helperFee) : 0;
    const nightFee = dto.nightService ? Number(rule.nightFee) : 0;

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

  previewManualQuote(
    user: AuthenticatedUser,
    dto: PreviewManualQuoteDto,
  ): Promise<ManualQuoteCalculation> {
    return this.calculateManualQuote(user, dto);
  }

  async calculateManualQuote(
    user: AuthenticatedUser,
    input: ManualQuoteInput,
  ): Promise<ManualQuoteCalculation> {
    const manualAdjustmentAmount = input.manualAdjustmentAmount ?? 0;
    if (manualAdjustmentAmount !== 0 && !user.roles.includes(ROLES.ADMIN)) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN_ROLE,
        message: 'Only administrators can apply manual price adjustments',
      });
    }

    const [customer, rule] = await Promise.all([
      this.prisma.customerProfile.findUnique({
        where: { id: input.customerId },
        select: { id: true },
      }),
      this.findActiveRule(input.vehicleCategoryId),
    ]);

    if (!customer) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: 'Customer profile not found',
      });
    }

    if (!rule) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'No active rate rule found for the selected vehicle category',
      });
    }

    const distanceKm = input.distanceKm;
    const estimatedDurationMin = Math.round(input.estimatedDurationMin ?? 0);
    const baseFare = Number(rule.baseFare);
    const pricePerKm = Number(rule.pricePerKM);
    const pricePerMinute = Number(rule.pricePerMinute);
    const minimumFare = Number(rule.minimumFare);
    const helperFee = input.helperRequired ? Number(rule.helperFee) : 0;
    const tollAmount = input.tollAmount ?? 0;
    const weightSurcharge = input.weightSurcharge ?? 0;
    const volumeSurcharge = input.volumeSurcharge ?? 0;
    const otherCharges = input.otherCharges ?? 0;
    const discountAmount = input.discountAmount ?? 0;
    const distanceAmount = distanceKm * pricePerKm;
    const durationAmount = estimatedDurationMin * pricePerMinute;
    const routeAmount = baseFare + distanceAmount + durationAmount;
    const extrasAmount =
      helperFee + tollAmount + weightSurcharge + volumeSurcharge + otherCharges;
    const subtotalBeforeMinimum = routeAmount + extrasAmount - discountAmount;
    const subtotal = Math.max(minimumFare, subtotalBeforeMinimum);
    const taxAmount = subtotal * TAX_RATE;
    const totalAmount = subtotal + taxAmount + manualAdjustmentAmount;

    const breakdown: Prisma.InputJsonObject = {
      quoteSource: QUOTE_SOURCE.MANUAL,
      quoteStatus: QUOTE_STATUS.PROVISIONAL,
      rateRuleId: rule.id,
      rateCardId: rule.rateCardId,
      baseFare,
      pricePerKm,
      pricePerMinute,
      minimumFare,
      distanceKm,
      estimatedDurationMin,
      distanceAmount: roundMoney(distanceAmount),
      durationAmount: roundMoney(durationAmount),
      routeAmount: roundMoney(routeAmount),
      helperFee: roundMoney(helperFee),
      tollAmount: roundMoney(tollAmount),
      weightSurcharge: roundMoney(weightSurcharge),
      volumeSurcharge: roundMoney(volumeSurcharge),
      otherCharges: roundMoney(otherCharges),
      discountAmount: roundMoney(discountAmount),
      subtotalBeforeMinimum: roundMoney(subtotalBeforeMinimum),
      subtotal: roundMoney(subtotal),
      taxRate: TAX_RATE,
      taxAmount: roundMoney(taxAmount),
      manualAdjustmentAmount: roundMoney(manualAdjustmentAmount),
      totalAmount: roundMoney(totalAmount),
    };

    return {
      quoteSource: QUOTE_SOURCE.MANUAL,
      quoteStatus: QUOTE_STATUS.PROVISIONAL,
      distanceKm,
      estimatedDurationMin,
      baseAmount: roundMoney(routeAmount),
      extrasAmount: roundMoney(extrasAmount),
      demandAmount: 0,
      weatherAmount: 0,
      taxAmount: roundMoney(taxAmount),
      totalAmount: roundMoney(totalAmount),
      manualAdjustmentAmount: roundMoney(manualAdjustmentAmount),
      adjustmentReason: input.adjustmentReason?.trim() || undefined,
      breakdown,
    };
  }

  createManualQuote(
    user: AuthenticatedUser,
    input: ManualQuoteInput,
    calculation: ManualQuoteCalculation,
    db: QuoteDbClient = this.prisma,
  ): Promise<PriceQuote> {
    return db.priceQuote.create({
      data: {
        customerId: input.customerId,
        orderId: input.orderId ?? null,
        vehicleCategoryId: input.vehicleCategoryId,
        originAddress: input.originAddress.trim(),
        destinationAddress: input.destinationAddress.trim(),
        distanceKm: calculation.distanceKm,
        estimatedDurationMin: calculation.estimatedDurationMin,
        baseAmount: calculation.baseAmount,
        extrasAmount: calculation.extrasAmount,
        demandAmount: calculation.demandAmount,
        weatherAmount: calculation.weatherAmount,
        taxAmount: calculation.taxAmount,
        totalAmount: calculation.totalAmount,
        quoteSource: calculation.quoteSource,
        quoteStatus: calculation.quoteStatus,
        breakdown: calculation.breakdown,
        manualAdjustmentAmount: calculation.manualAdjustmentAmount,
        adjustmentReason: calculation.adjustmentReason ?? null,
        adjustedBy: calculation.manualAdjustmentAmount !== 0 ? user.id : null,
        expiresAt: new Date(Date.now() + MANUAL_QUOTE_TTL_MS),
      },
    });
  }

  replaceActiveOrderQuotes(
    orderId: string,
    db: QuoteDbClient = this.prisma,
  ): Promise<Prisma.BatchPayload> {
    return db.priceQuote.updateMany({
      where: {
        orderId,
        quoteStatus: { not: QUOTE_STATUS.REPLACED },
      },
      data: { quoteStatus: QUOTE_STATUS.REPLACED },
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

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
