import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Redis } from 'ioredis';
import { notificationConfig } from '@/config';

/**
 * Shared Redis/Valkey connection for hot, short-lived state: driver presence,
 * H3 cell indexes and demand windows.
 *
 * BullMQ keeps its own connections; this one is for plain commands. Redis is
 * optional in development, so `client` is null when REDIS_URL is not set and
 * callers must degrade (presence off, legacy dispatch list) instead of failing.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis | null;

  constructor(
    @Inject(notificationConfig.KEY)
    config: ConfigType<typeof notificationConfig>,
  ) {
    if (!config.redisUrl) {
      this.client = null;
      this.logger.warn(
        'REDIS_URL is not set: driver presence and H3 matching are disabled',
      );
      return;
    }

    this.client = new Redis({
      host: config.redisHost,
      port: config.redisPort,
      password: config.redisPassword,
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    this.client.on('error', (error: Error) =>
      this.logger.error(`Redis error: ${error.message}`),
    );
  }

  get isEnabled(): boolean {
    return this.client !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
