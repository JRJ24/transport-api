import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { paymentConfig } from '@/config';

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
}
