import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  cert,
  getApps,
  initializeApp,
  applicationDefault,
} from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { notificationConfig } from '@/config';

export interface PushSendResult {
  successCount: number;
  failureCount: number;
  /** Tokens FCM reported as permanently invalid — deactivate these. */
  invalidTokens: string[];
}

/**
 * Wraps the Firebase Admin SDK for FCM HTTP v1 delivery. The private key never
 * leaves the backend. If credentials are not configured the service reports
 * `enabled = false` and all sends are no-ops (the caller degrades gracefully).
 */
@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private ready = false;

  constructor(
    @Inject(notificationConfig.KEY)
    private readonly config: ConfigType<typeof notificationConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.config.pushEnabled) {
      this.logger.warn(
        'Firebase Admin not configured — push notifications are disabled',
      );
      return;
    }

    try {
      if (getApps().length === 0) {
        initializeApp({
          credential: this.config.googleAppCredentials
            ? applicationDefault()
            : cert({
                projectId: this.config.firebaseProjectId,
                clientEmail: this.config.firebaseClientEmail,
                privateKey: this.config.firebasePrivateKey,
              }),
        });
      }
      this.ready = true;
      this.logger.log('Firebase Admin initialized (FCM HTTP v1)');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Firebase Admin: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  get enabled(): boolean {
    return this.ready;
  }

  /** Sends one message to many device tokens; classifies invalid tokens. */
  async sendToTokens(
    tokens: string[],
    payload: {
      title: string;
      body: string;
      data?: Record<string, string>;
    },
  ): Promise<PushSendResult> {
    if (!this.ready || tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const message: MulticastMessage = {
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default' } },
      },
    };

    const response = await getMessaging().sendEachForMulticast(message);
    const invalidTokens: string[] = [];

    response.responses.forEach((res, index) => {
      if (!res.success) {
        const code = res.error?.code ?? '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(tokens[index]);
        } else {
          this.logger.warn(`FCM send error for a token: ${code}`);
        }
      }
    });

    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      invalidTokens,
    };
  }
}
