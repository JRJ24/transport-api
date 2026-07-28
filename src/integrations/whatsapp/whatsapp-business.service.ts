import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Prisma } from '@generated/prisma/client';
import axios from 'axios';
import type { AxiosError } from 'axios';
import { whatsappConfig } from '@/config/whatsapp.config';
import { PrismaService } from '@/database/prisma.service';

export type WhatsAppDispatchStatus =
  'disabled' | 'missing-config' | 'sent' | 'failed';

export interface QuoteLeadWhatsAppInput {
  leadId: string;
  fullName: string;
  company?: string;
  phone: string;
  email?: string;
  service: string;
  origin: string;
  destination: string;
  description?: string;
  receivedAt: string;
}

export interface WhatsAppDispatchResult {
  provider: 'disabled' | 'meta' | '360dialog';
  status: WhatsAppDispatchStatus;
  destination?: string;
  providerMessageId?: string;
  error?: string;
}

type WhatsAppConfig = ConfigType<typeof whatsappConfig>;

@Injectable()
export class WhatsAppBusinessService {
  private readonly logger = new Logger(WhatsAppBusinessService.name);

  constructor(
    @Inject(whatsappConfig.KEY)
    private readonly config: WhatsAppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async notifyQuoteLead(
    input: QuoteLeadWhatsAppInput,
  ): Promise<WhatsAppDispatchResult> {
    if (this.config.provider === 'disabled') {
      return { provider: 'disabled', status: 'disabled' };
    }

    if (!this.config.enabled) {
      return {
        provider: this.config.provider,
        status: 'missing-config',
        error:
          'Configure WHATSAPP_API_KEY, WHATSAPP_LEADS_TO and WHATSAPP_PHONE_NUMBER_ID when using Meta.',
      };
    }

    const endpoint = this.endpoint();
    const payload = this.messagePayload(input);

    try {
      const response = await axios.post<Record<string, unknown>>(
        endpoint,
        payload,
        {
          headers: this.headers(),
          timeout: this.config.timeoutMs,
        },
      );
      const data = response.data ?? {};
      const messageId = this.extractMessageId(data);

      await this.logExternalApi({
        endpoint,
        requestPayload: payload,
        responsePayload: data,
        statusCode: response.status,
        success: true,
      });

      return {
        provider: this.config.provider,
        status: 'sent',
        destination: this.config.leadsTo,
        providerMessageId: messageId,
      };
    } catch (error) {
      const axiosError = axios.isAxiosError(error) ? error : undefined;
      const message = error instanceof Error ? error.message : 'Unknown error';
      const responsePayload = this.responsePayload(axiosError, message);

      await this.logExternalApi({
        endpoint,
        requestPayload: payload,
        responsePayload,
        statusCode: axiosError?.response?.status,
        success: false,
      });

      this.logger.warn(`WhatsApp quote lead notification failed: ${message}`);
      return {
        provider: this.config.provider,
        status: 'failed',
        destination: this.config.leadsTo,
        error: message,
      };
    }
  }

  private endpoint(): string {
    if (this.config.provider === 'meta') {
      return `${this.config.graphApiBaseUrl}/${this.config.phoneNumberId}/messages`;
    }

    return this.config.dialogApiUrl;
  }

  private headers(): Record<string, string> {
    if (this.config.provider === '360dialog') {
      return {
        'content-type': 'application/json',
        'D360-API-KEY': this.config.apiKey,
      };
    }

    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  private messagePayload(
    input: QuoteLeadWhatsAppInput,
  ): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      to: this.config.leadsTo,
      type: 'text',
      text: {
        preview_url: false,
        body: this.messageBody(input),
      },
    };
  }

  private messageBody(input: QuoteLeadWhatsAppInput): string {
    return [
      `Nueva cotizacion web - ${input.leadId}`,
      `Fecha: ${input.receivedAt}`,
      `Nombre: ${input.fullName}`,
      input.company ? `Empresa: ${input.company}` : undefined,
      `Telefono: ${input.phone}`,
      input.email ? `Email: ${input.email}` : undefined,
      `Servicio: ${input.service}`,
      `Origen: ${input.origin}`,
      `Destino: ${input.destination}`,
      input.description ? `Detalle: ${input.description}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private extractMessageId(data: Record<string, unknown>): string | undefined {
    const messages = data.messages;

    if (!Array.isArray(messages)) {
      return undefined;
    }

    const first = messages[0] as { id?: unknown } | undefined;
    return typeof first?.id === 'string' ? first.id : undefined;
  }

  private responsePayload(
    error: AxiosError<unknown> | undefined,
    message: string,
  ): Record<string, unknown> {
    const data = error?.response?.data;

    if (this.isRecord(data)) {
      return data;
    }

    return { error: message };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async logExternalApi(input: {
    endpoint: string;
    requestPayload: Record<string, unknown>;
    responsePayload: Record<string, unknown>;
    statusCode?: number;
    success: boolean;
  }): Promise<void> {
    try {
      await this.prisma.externalApiLog.create({
        data: {
          provider: `whatsapp:${this.config.provider}`,
          endpoint: input.endpoint,
          requestPayload: input.requestPayload as Prisma.InputJsonObject,
          responsePayload: input.responsePayload as Prisma.InputJsonObject,
          statusCode: input.statusCode,
          success: input.success,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not persist WhatsApp API log: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
