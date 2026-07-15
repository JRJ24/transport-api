import { registerAs } from '@nestjs/config';

export const notificationConfig = registerAs('notification', () => ({
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'no-reply@rutard.local',
  fcmProjectId: process.env.FCM_PROJECT_ID ?? '',
}));
