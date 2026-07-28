import { randomBytes, randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { Prisma, TransportOrder } from '@generated/prisma/client';
import {
  DOCUMENT_TYPE,
  EVENT_TYPE,
  PAYMENT_STATUS,
  ROLES,
  SERVICE_TYPE,
  STATUS_ACCOUNT,
  STATUS_ORDERS,
  STOP_TYPE,
  TYPE_CUSTOMER,
} from '@generated/prisma/enums';
import { hashPassword } from '@/common/utils/hash.util';
import {
  WhatsAppBusinessService,
  type WhatsAppDispatchResult,
} from '@/integrations/whatsapp/whatsapp-business.service';
import { PrismaService } from '@/database/prisma.service';
import type { CreateQuoteLeadDto } from './dto/create-quote-lead.dto';

type TxClient = Prisma.TransactionClient;

export interface QuoteLeadRequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface QuoteLeadReceipt {
  leadId: string;
  status: 'received';
  receivedAt: string;
  order: {
    id: string;
    orderCode: string;
    status: STATUS_ORDERS;
  };
  email: QuoteLeadEmailResult;
  whatsapp: WhatsAppDispatchResult;
}

export interface QuoteLeadEmailResult {
  provider: 'smtp';
  status: 'sent' | 'missing-config' | 'failed';
  destination: string;
  providerMessageId?: string;
  error?: string;
}

@Injectable()
export class QuoteLeadsService {
  private readonly logger = new Logger(QuoteLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppBusinessService,
  ) {}

  async create(
    dto: CreateQuoteLeadDto,
    meta: QuoteLeadRequestMeta,
  ): Promise<QuoteLeadReceipt> {
    const leadId = `quote_${randomUUID()}`;
    const receivedAt = new Date().toISOString();
    const order = await this.createPendingOrderFromLead(dto, leadId, meta);
    const [whatsapp, email] = await Promise.all([
      this.whatsapp.notifyQuoteLead({
        leadId,
        fullName: dto.fullName,
        company: dto.company,
        phone: dto.phone,
        email: dto.email,
        service: dto.service,
        origin: dto.origin,
        destination: dto.destination,
        description: dto.description,
        receivedAt,
      }),
      this.notifyQuoteLeadEmail(dto, leadId, receivedAt, order),
    ]);
    const leadPayload = this.compact({
      fullName: dto.fullName,
      company: dto.company,
      phone: dto.phone,
      email: dto.email,
      service: dto.service,
      origin: dto.origin,
      destination: dto.destination,
      description: dto.description,
      consentWhatsapp: dto.consentWhatsapp,
      source: dto.source,
      landingUrl: dto.landingUrl,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
    });
    const whatsappPayload = this.compact({
      provider: whatsapp.provider,
      status: whatsapp.status,
      destination: whatsapp.destination,
      providerMessageId: whatsapp.providerMessageId,
      error: whatsapp.error,
    });
    const emailPayload = this.compact({
      provider: email.provider,
      status: email.status,
      destination: email.destination,
      providerMessageId: email.providerMessageId,
      error: email.error,
    });

    await this.prisma.webhookEvent.create({
      data: {
        eventType: 'public.quote_lead.created',
        externalEventId: leadId,
        payload: {
          leadId,
          receivedAt,
          order: {
            id: order.id,
            orderCode: order.orderCode,
            status: order.status,
          },
          lead: leadPayload,
          meta: this.compact({
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          }),
          email: emailPayload,
          whatsapp: whatsappPayload,
        } as unknown as Prisma.InputJsonObject,
        processed: true,
        processedAt: new Date(),
        createdAt: new Date(),
      },
    });

    return {
      leadId,
      status: 'received',
      receivedAt,
      order: {
        id: order.id,
        orderCode: order.orderCode,
        status: order.status,
      },
      email,
      whatsapp,
    };
  }

  private async createPendingOrderFromLead(
    dto: CreateQuoteLeadDto,
    leadId: string,
    meta: QuoteLeadRequestMeta,
  ): Promise<TransportOrder> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await this.findOrCreateLeadCustomer(tx, dto, leadId);
      const category = await this.findVehicleCategory(tx, dto.service);
      const order = await tx.transportOrder.create({
        data: {
          orderCode: this.generateOrderCode(),
          customerId: customer.id,
          vehicleCategoryId: category.id,
          serviceType: SERVICE_TYPE.INMEDIATE,
          status: STATUS_ORDERS.PENDING_QUOTE,
          scheduleAt: null,
          pickupAt: null,
          deliveredAt: null,
          distanceKm: null,
          estimatedDurationMin: null,
          totalAmount: null,
          paymentStatus: PAYMENT_STATUS.PENDING,
          notes: this.leadNotes(dto, leadId),
          orderStops: {
            create: [
              {
                stopType: STOP_TYPE.PICKUP,
                sequence: 1,
                contactName: dto.fullName,
                contactPhone: dto.phone,
                addressLine: dto.origin,
                city: 'Por confirmar',
                province: 'Por confirmar',
                instructions: 'Origen capturado desde cotizacion web',
              },
              {
                stopType: STOP_TYPE.DROPOFF,
                sequence: 2,
                contactName: dto.fullName,
                contactPhone: dto.phone,
                addressLine: dto.destination,
                city: 'Por confirmar',
                province: 'Por confirmar',
                instructions: 'Destino capturado desde cotizacion web',
              },
            ],
          },
          orderItems: {
            create: {
              description:
                dto.description?.trim() || this.serviceLabel(dto.service),
              quantity: 1,
              weightKg: 0,
              volumeM3: null,
              declaredValue: null,
              fragile: false,
              requireHelper: false,
            },
          },
          orderEvents: {
            create: {
              eventType: EVENT_TYPE.CREATED,
              actorUserId: customer.userId,
              description: 'Quote lead created from public website',
              metadata: {
                leadId,
                source: dto.source ?? 'landing',
                landingUrl: dto.landingUrl,
                utmSource: dto.utmSource,
                utmMedium: dto.utmMedium,
                utmCampaign: dto.utmCampaign,
              },
              latitude: null,
              longitude: null,
            },
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: 'PUBLIC_QUOTE_LEAD_CREATED',
          entityType: 'ORDER',
          entityId: order.id,
          newValues: {
            leadId,
            orderId: order.id,
            orderCode: order.orderCode,
            status: order.status,
            customerId: customer.id,
            source: dto.source ?? 'landing',
          },
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
          createdAt: new Date(),
        },
      });

      return order;
    });
  }

  private async findOrCreateLeadCustomer(
    tx: TxClient,
    dto: CreateQuoteLeadDto,
    leadId: string,
  ) {
    const email = dto.email?.toLowerCase().trim();
    const phone = dto.phone.trim();
    const user = await tx.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          { phone },
        ],
      },
      select: { id: true },
    });
    const userId = user?.id ?? (await this.createLeadUser(tx, dto, leadId)).id;

    await this.ensureCustomerRole(tx, userId);

    const existingCustomer = await tx.customerProfile.findFirst({
      where: { userId },
    });

    if (existingCustomer) {
      return existingCustomer;
    }

    return tx.customerProfile.create({
      data: {
        userId,
        customerType: dto.company ? TYPE_CUSTOMER.BUSINESS : TYPE_CUSTOMER.INDIVIDUAL,
        documentType: DOCUMENT_TYPE.ID,
        documentNumber: `LEAD-${leadId.slice(-12)}`,
        companyName: dto.company ?? null,
        billingEmail: email ?? null,
        createdAt: new Date(),
      },
    });
  }

  private async createLeadUser(
    tx: TxClient,
    dto: CreateQuoteLeadDto,
    leadId: string,
  ) {
    const passwordHash = await hashPassword(
      randomBytes(24).toString('base64url'),
      Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
    );

    return tx.user.create({
      data: {
        fullName: dto.fullName.trim(),
        email:
          dto.email?.toLowerCase().trim() ??
          `${leadId.replace(/[^a-z0-9]/gi, '').toLowerCase()}@leads.larutard.local`,
        phone: dto.phone.trim(),
        passwordHash,
        status: STATUS_ACCOUNT.ACTIVE,
        userRoles: {
          create: { rol: { connect: { code: ROLES.CUSTOMER } } },
        },
      },
      select: { id: true },
    });
  }

  private async ensureCustomerRole(tx: TxClient, userId: string): Promise<void> {
    const role = await tx.userRole.findFirst({
      where: { userID: userId, rol: { code: ROLES.CUSTOMER } },
      select: { id: true },
    });

    if (role) {
      return;
    }

    await tx.userRole.create({
      data: {
        user: { connect: { id: userId } },
        rol: { connect: { code: ROLES.CUSTOMER } },
      },
    });
  }

  private async findVehicleCategory(tx: TxClient, service: string) {
    const code = this.vehicleCategoryCode(service);
    const category = await tx.vehicleCategory.findFirst({
      where: { code, isActive: true },
    });

    if (category) {
      return category;
    }

    const fallback = await tx.vehicleCategory.findFirst({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    if (!fallback) {
      throw new BadRequestException('No active vehicle category is available');
    }

    return fallback;
  }

  private async notifyQuoteLeadEmail(
    dto: CreateQuoteLeadDto,
    leadId: string,
    receivedAt: string,
    order: TransportOrder,
  ): Promise<QuoteLeadEmailResult> {
    const destination = (process.env.QUOTE_LEADS_EMAIL_TO ?? 'info@larutard.com.do')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .join(',');
    const host = process.env.SMTP_HOST?.trim();

    if (!host) {
      return {
        provider: 'smtp',
        status: 'missing-config',
        destination,
        error: 'SMTP_HOST is not configured',
      };
    }

    try {
      const port = Number(process.env.SMTP_PORT ?? 587);
      const smtpUser = process.env.SMTP_USER?.trim();
      const smtpPassword = process.env.SMTP_PASSWORD;
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth:
          smtpUser && smtpPassword
            ? { user: smtpUser, pass: smtpPassword }
            : undefined,
      });
      const result = await transporter.sendMail({
        from: process.env.EMAIL_FROM?.trim() || 'info@larutard.com.do',
        to: destination,
        subject: `Nueva cotizacion web ${order.orderCode}`,
        text: this.emailBody(dto, leadId, receivedAt, order),
      });

      return {
        provider: 'smtp',
        status: 'sent',
        destination,
        providerMessageId: result.messageId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Quote lead email notification failed: ${message}`);

      return {
        provider: 'smtp',
        status: 'failed',
        destination,
        error: message,
      };
    }
  }

  private emailBody(
    dto: CreateQuoteLeadDto,
    leadId: string,
    receivedAt: string,
    order: TransportOrder,
  ): string {
    return [
      `Nueva cotizacion web - ${leadId}`,
      `Orden TMS: ${order.orderCode}`,
      `Estado: ${order.status}`,
      `Fecha: ${receivedAt}`,
      `Nombre: ${dto.fullName}`,
      dto.company ? `Empresa: ${dto.company}` : undefined,
      `Telefono: ${dto.phone}`,
      dto.email ? `Email: ${dto.email}` : undefined,
      `Servicio: ${this.serviceLabel(dto.service)}`,
      `Origen: ${dto.origin}`,
      `Destino: ${dto.destination}`,
      dto.description ? `Detalle: ${dto.description}` : undefined,
      dto.landingUrl ? `Landing: ${dto.landingUrl}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private leadNotes(dto: CreateQuoteLeadDto, leadId: string): string {
    return [
      `Lead pendiente desde website (${leadId}).`,
      `Servicio solicitado: ${this.serviceLabel(dto.service)}.`,
      dto.company ? `Empresa: ${dto.company}.` : undefined,
      dto.email ? `Email: ${dto.email}.` : undefined,
      dto.description ? `Detalle: ${dto.description}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private vehicleCategoryCode(service: string): string {
    switch (service) {
      case 'mensajeria-express':
        return 'MOTO';
      case 'carga-nacional-seca':
        return 'CAMION';
      case 'distribucion-local':
      case 'cadena-frio':
      case 'otro':
      default:
        return 'VAN';
    }
  }

  private serviceLabel(service: string): string {
    switch (service) {
      case 'mensajeria-express':
        return 'Mensajeria express urbana';
      case 'distribucion-local':
        return 'Distribucion local e institucional';
      case 'carga-nacional-seca':
        return 'Carga nacional seca';
      case 'cadena-frio':
        return 'Cadena de frio';
      default:
        return 'Otro';
    }
  }

  private generateOrderCode(): string {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();

    return `ORD-${Date.now()}-${suffix}`;
  }

  private compact(input: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
  }
}
