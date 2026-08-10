import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Prisma } from '@generated/prisma/client';
import { paymentConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';

export interface CardnetSessionResponse {
  SESSION: string;
  'session-key': string;
}

@Injectable()
export class CardnetGateway {
  private readonly logger = new Logger(CardnetGateway.name);

  constructor(
    @Inject(paymentConfig.KEY)
    private readonly config: ConfigType<typeof paymentConfig>,
    private readonly prisma: PrismaService,
  ) {}

  async createSession(
    payload: Record<string, string>,
  ): Promise<CardnetSessionResponse> {
    const url = this.config.cardnetSessionUrl;

    if (!url) {
      throw new BadGatewayException('CARDNET_SESSION_URL is not configured');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const rawBody = await response.text();

    await this.logExternalApi(
      url,
      payload,
      rawBody,
      response.status,
      response.ok,
    );

    if (!response.ok) {
      this.logger.error(
        `CardNET createSession failed: status=${response.status}`,
      );
      throw new BadGatewayException(
        'No fue posible iniciar el pago con CardNET',
      );
    }

    const data = this.parseJson(rawBody);
    const session = this.optionalString(data.SESSION ?? data.Session);
    const sessionKey = this.optionalString(
      data['session-key'] ?? data.sessionKey ?? data.SessionKey,
    );

    if (!session || !sessionKey) {
      throw new BadGatewayException('CardNET no devolvio la sesion esperada');
    }

    return { SESSION: session, 'session-key': sessionKey };
  }

  async getResult(
    session: string,
    sessionKey: string,
  ): Promise<Record<string, unknown>> {
    const baseUrl = this.config.cardnetSessionUrl;

    if (!baseUrl) {
      throw new BadGatewayException('CARDNET_SESSION_URL is not configured');
    }

    const url =
      `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(session)}` +
      `?sk=${encodeURIComponent(sessionKey)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const rawBody = await response.text();

    await this.logExternalApi(
      url,
      { session },
      rawBody,
      response.status,
      response.ok,
    );

    if (!response.ok) {
      throw new BadGatewayException(
        `No se pudo consultar el pago en CardNET: ${response.status}`,
      );
    }

    return this.parseJson(rawBody);
  }

  private parseJson(rawBody: string): Record<string, unknown> {
    try {
      const data = JSON.parse(rawBody) as unknown;

      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data as Record<string, unknown>;
      }
    } catch {
      throw new BadGatewayException('CardNET devolvio una respuesta invalida');
    }

    throw new BadGatewayException('CardNET devolvio una respuesta invalida');
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private async logExternalApi(
    endpoint: string,
    requestPayload: Record<string, unknown>,
    rawBody: string,
    statusCode: number,
    success: boolean,
  ): Promise<void> {
    try {
      await this.prisma.externalApiLog.create({
        data: {
          provider: 'cardnet',
          endpoint: this.safeEndpoint(endpoint),
          requestPayload: requestPayload as Prisma.InputJsonObject,
          responsePayload: this.responsePayload(rawBody),
          statusCode,
          success,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `CardNET external API log failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  private responsePayload(rawBody: string): Prisma.InputJsonObject {
    try {
      const parsed = JSON.parse(rawBody) as unknown;

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return { rawBody: rawBody.slice(0, 5000) };
    }

    return { rawBody: rawBody.slice(0, 5000) };
  }

  private safeEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      url.search = '';
      return url.toString();
    } catch {
      return endpoint.split('?')[0] ?? endpoint;
    }
  }
}
