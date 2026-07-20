import { Injectable, Logger } from '@nestjs/common';
import type { DeviceToken } from '@generated/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import type { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers (or refreshes) a device token for the user. Keyed by
   * (userId, installationId) so a reinstall/token-refresh updates in place, and
   * the token is also globally unique so it can't belong to two users.
   */
  async register(userId: string, dto: RegisterDeviceDto): Promise<DeviceToken> {
    const now = new Date();

    // If this exact token exists under another user, move it to this user.
    await this.prisma.deviceToken.updateMany({
      where: { token: dto.token, NOT: { userId } },
      data: { isActive: false },
    });

    return this.prisma.deviceToken.upsert({
      where: {
        user_installation: { userId, installationId: dto.installationId },
      },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
        installationId: dto.installationId,
        deviceName: dto.deviceName ?? null,
        appVersion: dto.appVersion ?? null,
        locale: dto.locale ?? null,
        isActive: true,
        lastUsedAt: now,
      },
      update: {
        token: dto.token,
        platform: dto.platform,
        deviceName: dto.deviceName ?? null,
        appVersion: dto.appVersion ?? null,
        locale: dto.locale ?? null,
        isActive: true,
        failureCount: 0,
        lastUsedAt: now,
      },
    });
  }

  listActive(userId: string): Promise<DeviceToken[]> {
    return this.prisma.deviceToken.findMany({
      where: { userId, isActive: true },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /** Removes/deactivates a token at logout (only the owner's token). */
  async deactivate(userId: string, token: string): Promise<{ count: number }> {
    const result = await this.prisma.deviceToken.updateMany({
      where: { userId, token },
      data: { isActive: false },
    });
    return { count: result.count };
  }

  /** Deactivates tokens FCM reported as permanently invalid. */
  async deactivateInvalid(tokens: string[]): Promise<void> {
    if (tokens.length === 0) {
      return;
    }
    await this.prisma.deviceToken.updateMany({
      where: { token: { in: tokens } },
      data: { isActive: false },
    });
    this.logger.log(`Deactivated ${tokens.length} invalid device token(s)`);
  }
}
