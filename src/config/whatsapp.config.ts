import { registerAs } from '@nestjs/config';
import { env } from './env.validation';

export type WhatsAppProvider = 'disabled' | 'meta' | '360dialog';

function normalizeProvider(value: string): WhatsAppProvider {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'meta') {
    return 'meta';
  }

  if (normalized === '360dialog') {
    return '360dialog';
  }

  return 'disabled';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

export const whatsappConfig = registerAs('whatsapp', () => {
  const e = env();
  const provider = normalizeProvider(e.WHATSAPP_PROVIDER);
  const apiKey = e.WHATSAPP_API_KEY ?? '';
  const leadsTo = e.WHATSAPP_LEADS_TO ?? '';
  const phoneNumberId = e.WHATSAPP_PHONE_NUMBER_ID ?? '';
  const hasRequiredCredentials =
    Boolean(apiKey && leadsTo) &&
    (provider === '360dialog' || Boolean(phoneNumberId));
  const enabled = provider !== 'disabled' && hasRequiredCredentials;

  return {
    provider,
    enabled,
    apiKey,
    phoneNumberId,
    leadsTo,
    publicFallbackNumber: e.WHATSAPP_PUBLIC_FALLBACK_NUMBER ?? '',
    graphApiBaseUrl: trimTrailingSlash(e.WHATSAPP_GRAPH_API_BASE_URL),
    dialogApiUrl: e.WHATSAPP_360DIALOG_API_URL,
    timeoutMs: e.WHATSAPP_TIMEOUT_MS,
  };
});
