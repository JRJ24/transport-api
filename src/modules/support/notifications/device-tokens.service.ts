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
    try {
      return await this.registerOnce(userId, dto);
    } catch (error) {
      // Dos registros simultaneos del mismo token (login + onTokenRefresh, o
      // dos cuentas en el mismo telefono) pueden chocar en el indice unico
      // aunque cada uno libere el token antes. Al reintentar ya se ve la fila
      // que confirmo el otro y el delete/upsert la resuelve; una sola vez basta.
      if (!isConcurrentWriteConflict(error)) {
        throw error;
      }
      this.logger.warn(
        `Device token register conflict for user ${userId}; retrying once`,
      );
      return this.registerOnce(userId, dto);
    }
  }

  private registerOnce(
    userId: string,
    dto: RegisterDeviceDto,
  ): Promise<DeviceToken> {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // El token FCM es del dispositivo, no de la cuenta: si otro conductor
      // entra en el mismo telefono llega el mismo token. Solo desactivar la
      // fila anterior dejaba el token ocupado y el create del upsert daba
      // P2002 (409). Se borra (no se reasigna) porque esa fila ya no le sirve
      // al usuario anterior, y si seguia activa (logout con sesion vencida)
      // este telefono recibiria sus push. Tambien libera el token nuevo de un
      // refresh si quedo en otra fila.
      await tx.deviceToken.deleteMany({
        where: {
          token: dto.token,
          NOT: { userId, installationId: dto.installationId },
        },
      });

      // Misma instalacion con token nuevo (refresh de FCM): se actualiza la
      // fila en lugar de crear otra.
      return tx.deviceToken.upsert({
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

// P2002: indice unico (token o user_installation) ocupado por un registro
// concurrente. P2034: el adapter pg solo lo emite ante 40001 (serialization
// failure), que aparece si la BD corre con aislamiento mas estricto que READ
// COMMITTED. Ambos se resuelven repitiendo la transaccion.
function isConcurrentWriteConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'P2002' || code === 'P2034';
}
