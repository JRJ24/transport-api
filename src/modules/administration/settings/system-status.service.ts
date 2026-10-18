import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  getUnservedUploadFolders,
  isUnsafeLocalUploadRoot,
  resolveStorageTarget,
} from '@/common/middlewares/processFile';
import { notificationConfig, paymentConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { RedisService } from '@/database/redis.service';
import { googleMapsConfig } from '@/integrations/google-maps/google-maps.config';

export type CheckState = 'ok' | 'warning' | 'error';

export interface SystemCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

/**
 * What the portal's "Estado del sistema" shows: real checks of each
 * dependency. It never returns secrets, only whether they are configured.
 */
@Injectable()
export class SystemStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(googleMapsConfig.KEY)
    private readonly maps: ConfigType<typeof googleMapsConfig>,
    @Inject(paymentConfig.KEY)
    private readonly payments: ConfigType<typeof paymentConfig>,
    @Inject(notificationConfig.KEY)
    private readonly notifications: ConfigType<typeof notificationConfig>,
  ) {}

  async checks(): Promise<{
    overall: CheckState;
    checks: SystemCheck[];
    checkedAt: string;
  }> {
    const checks: SystemCheck[] = [
      await this.database(),
      await this.redisCheck(),
      this.mapsCheck(),
      this.storageCheck(),
      this.paymentsCheck(),
      this.pushCheck(),
      this.emailCheck(),
    ];
    const overall: CheckState = checks.some((check) => check.state === 'error')
      ? 'error'
      : checks.some((check) => check.state === 'warning')
        ? 'warning'
        : 'ok';
    return { overall, checks, checkedAt: new Date().toISOString() };
  }

  private async database(): Promise<SystemCheck> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        id: 'database',
        label: 'Base de datos',
        state: 'ok',
        detail: `Responde en ${Date.now() - started} ms`,
      };
    } catch {
      return {
        id: 'database',
        label: 'Base de datos',
        state: 'error',
        detail: 'No responde',
      };
    }
  }

  private async redisCheck(): Promise<SystemCheck> {
    const label = 'Redis (ubicación de conductores y colas)';
    if (!this.redis.client) {
      return {
        id: 'redis',
        label,
        state: 'warning',
        detail: 'No configurado: sin despacho H3 ni ofertas automáticas',
      };
    }
    try {
      const started = Date.now();
      await this.redis.client.ping();
      return {
        id: 'redis',
        label,
        state: 'ok',
        detail: `Responde en ${Date.now() - started} ms`,
      };
    } catch {
      return {
        id: 'redis',
        label,
        state: 'error',
        detail: 'Configurado pero no responde',
      };
    }
  }

  private mapsCheck(): SystemCheck {
    const label = 'Google Maps (rutas y ETA)';
    if (this.maps.useMocks) {
      return {
        id: 'maps',
        label,
        state: 'warning',
        detail: 'Modo simulado: distancias en línea recta',
      };
    }
    return this.maps.serverApiKey
      ? {
          id: 'maps',
          label,
          state: 'ok',
          detail: 'Clave de servidor configurada',
        }
      : {
          id: 'maps',
          label,
          state: 'error',
          detail: 'Falta la clave de servidor',
        };
  }

  /**
   * El destino real de storeObject (resolveStorageTarget), no solo la config:
   * con bucket pero sin claves los archivos iban a disco y aqui salia OK.
   */
  private storageCheck(): SystemCheck {
    const id = 'storage';
    const label = 'Almacenamiento de evidencias';
    const target = resolveStorageTarget();
    if (target.driver === 'spaces') {
      return {
        id,
        label,
        state: 'ok',
        detail: `Bucket ${target.bucket} (${target.region})`,
      };
    }

    // Se pidio Spaces/S3 y falta configuracion: error, como antes sin bucket,
    // aunque los archivos se sigan guardando en disco.
    const fallback = target.reason === 'missing-config';
    const detail = fallback
      ? `Falta ${target.missing.join(', ')}: las evidencias se guardan en el disco local del servidor`
      : 'Disco local del servidor (no recomendado en producción)';

    // serveLocalUploads no monta esa carpeta: se guardan pero dan 404.
    if (isUnsafeLocalUploadRoot()) {
      return {
        id,
        label,
        state: 'error',
        detail: `${detail}. No se publican: LOCAL_UPLOAD_DIR es la carpeta del proyecto o la contiene`,
      };
    }

    // Tampoco monta una carpeta que no es una ruta relativa simple: esas
    // evidencias dan 404 aunque el resto funcione.
    const unserved = getUnservedUploadFolders();
    if (unserved.length > 0) {
      return {
        id,
        label,
        state: 'error',
        detail: `${detail}. No se publica ${unserved.join(', ')}: SPACES_UPLOAD_PREFIX no es una ruta relativa simple`,
      };
    }

    return { id, label, state: fallback ? 'error' : 'warning', detail };
  }

  private paymentsCheck(): SystemCheck {
    const provider = this.payments.defaultProvider;
    const environment =
      provider === 'cardnet'
        ? this.payments.cardnetEnvironment
        : provider === 'azul'
          ? this.payments.azulEnvironment
          : 'interno';
    const production = environment === 'production';
    return {
      id: 'payments',
      label: 'Pagos con tarjeta',
      state: provider === 'internal-mock' ? 'warning' : 'ok',
      detail: `${provider.toUpperCase()} · ambiente ${production ? 'producción' : String(environment)}`,
    };
  }

  private pushCheck(): SystemCheck {
    return this.notifications.pushEnabled
      ? {
          id: 'push',
          label: 'Notificaciones push',
          state: 'ok',
          detail: `Firebase ${this.notifications.firebaseProjectId || 'configurado'}`,
        }
      : {
          id: 'push',
          label: 'Notificaciones push',
          state: 'warning',
          detail: 'Sin credenciales de Firebase: solo avisos dentro de la app',
        };
  }

  private emailCheck(): SystemCheck {
    return this.notifications.smtpHost
      ? {
          id: 'email',
          label: 'Correo saliente',
          state: 'ok',
          detail: `SMTP ${this.notifications.smtpHost}`,
        }
      : {
          id: 'email',
          label: 'Correo saliente',
          state: 'warning',
          detail: 'Sin SMTP: no se envían códigos por correo',
        };
  }
}
