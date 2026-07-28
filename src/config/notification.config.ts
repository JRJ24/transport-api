import { registerAs } from '@nestjs/config';

/**
 * Notification + push delivery configuration. Firebase Admin credentials live
 * ONLY on the backend. When they are absent, push delivery is disabled and the
 * system degrades to storing + realtime-emitting notifications.
 */
export const notificationConfig = registerAs('notification', () => {
  const firebaseProjectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.FCM_PROJECT_ID ?? '';
  const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? '';
  // Support both escaped "\n" (env files) and real newlines (secret managers).
  const firebasePrivateKey = (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(
    /\\n/g,
    '\n',
  );
  const googleAppCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? '';

  const hasInlineCreds = Boolean(
    firebaseProjectId && firebaseClientEmail && firebasePrivateKey,
  );
  const pushEnabled = hasInlineCreds || Boolean(googleAppCredentials);

  const redisUrl = process.env.REDIS_URL ?? '';
  const queueDriver =
    process.env.NOTIFICATIONS_QUEUE_DRIVER ?? (redisUrl ? 'bullmq' : 'inline');

  // Derive connection parts (host/port/password) from REDIS_URL when provided,
  // otherwise fall back to discrete REDIS_HOST/REDIS_PORT.
  let redisHost = process.env.REDIS_HOST ?? '127.0.0.1';
  let redisPort = Number(process.env.REDIS_PORT ?? 6379);
  let redisPassword: string | undefined;
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      redisHost = parsed.hostname || redisHost;
      redisPort = parsed.port ? Number(parsed.port) : redisPort;
      redisPassword = parsed.password || undefined;
    } catch {
      // Keep discrete fallbacks if the URL is malformed.
    }
  }

  return {
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPassword: process.env.SMTP_PASSWORD ?? '',
    emailFrom: process.env.EMAIL_FROM ?? 'info@larutard.com.do',
    fcmProjectId: firebaseProjectId,

    firebaseProjectId,
    firebaseClientEmail,
    firebasePrivateKey,
    googleAppCredentials,
    pushEnabled,

    redisUrl,
    redisHost,
    redisPort,
    redisPassword,
    queueDriver: queueDriver as 'bullmq' | 'inline',
  };
});
