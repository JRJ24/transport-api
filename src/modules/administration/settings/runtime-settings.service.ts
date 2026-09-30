import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { SYSTEM_VALUE } from '@generated/prisma/enums';
import { z } from 'zod';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import { demandConfig, matchingConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';

/** How often every instance re-reads the table, so an edit lands without a restart. */
const REFRESH_MS = 30_000;

type Envs = {
  matching: ConfigType<typeof matchingConfig>;
  demand: ConfigType<typeof demandConfig>;
};

interface SettingDefinition<T> {
  valueType: SYSTEM_VALUE;
  group: 'dispatch' | 'pricing';
  label: string;
  description: string;
  schema: z.ZodType<T>;
  /** Value when nothing is stored: the environment, or the built-in default. */
  fallback: (env: Envs) => T;
}

const weightsSchema = z
  .object({
    eta: z.number().min(0).max(1),
    distance: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    balance: z.number().min(0).max(1),
  })
  .refine(
    (weights) =>
      weights.eta + weights.distance + weights.reliability + weights.balance >
      0,
    { message: 'At least one weight must be above 0' },
  );

const bandsSchema = z
  .array(
    z.object({
      above: z.number().min(0).max(20),
      multiplier: z.number().min(1).max(3),
      label: z.string().min(1).max(40),
    }),
  )
  .max(10);

/**
 * Every setting an administrator can change from the portal. Anything not
 * listed here is not editable through /settings/runtime.
 */
export const RUNTIME_SETTINGS = {
  'matching.auto_offer': {
    valueType: SYSTEM_VALUE.BOOLEAN,
    group: 'dispatch',
    label: 'Ofertas automáticas',
    description:
      'Al pagarse una orden se ofrece sola al conductor mejor ubicado. Apagado: el operador asigna desde el TMS.',
    schema: z.boolean(),
    fallback: (env) => env.matching.autoOffer === 'on',
  } satisfies SettingDefinition<boolean>,
  'matching.offer_ttl_sec': {
    valueType: SYSTEM_VALUE.NUMBER,
    group: 'dispatch',
    label: 'Tiempo para aceptar una oferta (segundos)',
    description:
      'Si el conductor no responde en este tiempo, pasa al siguiente.',
    schema: z.number().int().min(10).max(300),
    fallback: (env) => env.matching.offerTtlSec,
  } satisfies SettingDefinition<number>,
  'matching.max_rings': {
    valueType: SYSTEM_VALUE.NUMBER,
    group: 'dispatch',
    label: 'Radio de búsqueda (anillos H3)',
    description:
      'Cuántos anillos de celdas (≈ 460 m cada uno) alrededor de la recogida se revisan.',
    schema: z.number().int().min(0).max(8),
    fallback: (env) => env.matching.maxRings,
  } satisfies SettingDefinition<number>,
  'matching.score.weights': {
    valueType: SYSTEM_VALUE.JSON,
    group: 'dispatch',
    label: 'Pesos del ranking',
    description:
      'Cuánto pesa cada factor al ordenar candidatos. Se normalizan para sumar 100 %.',
    schema: weightsSchema,
    fallback: () => ({
      eta: 0.55,
      distance: 0.15,
      reliability: 0.15,
      balance: 0.15,
    }),
  } satisfies SettingDefinition<z.infer<typeof weightsSchema>>,
  'pricing.demand.mode': {
    valueType: SYSTEM_VALUE.STRING,
    group: 'pricing',
    label: 'Tarifa dinámica',
    description:
      'Apagada, en observación (se calcula y registra sin cobrar) o activa (se cobra).',
    schema: z.enum(['off', 'shadow', 'on']),
    fallback: (env) => env.demand.mode,
  } satisfies SettingDefinition<'off' | 'shadow' | 'on'>,
  'pricing.demand.bands': {
    valueType: SYSTEM_VALUE.JSON,
    group: 'pricing',
    label: 'Bandas de demanda',
    description:
      'Multiplicador según solicitudes por conductor disponible en la zona.',
    schema: bandsSchema,
    fallback: () => [
      { above: 1, multiplier: 1.1, label: 'MODERADO' },
      { above: 1.5, multiplier: 1.2, label: 'ALTO' },
      { above: 2, multiplier: 1.35, label: 'MUY_ALTO' },
    ],
  } satisfies SettingDefinition<z.infer<typeof bandsSchema>>,
  'tax.rate': {
    valueType: SYSTEM_VALUE.NUMBER,
    group: 'pricing',
    label: 'ITBIS',
    description: 'Impuesto aplicado a las cotizaciones nuevas (0.18 = 18 %).',
    schema: z.number().min(0).max(0.3),
    fallback: () => 0.18,
  } satisfies SettingDefinition<number>,
} as const;

export type RuntimeSettingKey = keyof typeof RUNTIME_SETTINGS;
type ValueOf<K extends RuntimeSettingKey> = z.infer<
  (typeof RUNTIME_SETTINGS)[K]['schema']
>;

export interface RuntimeSettingView {
  key: RuntimeSettingKey;
  group: string;
  label: string;
  description: string;
  valueType: SYSTEM_VALUE;
  value: unknown;
  /** `database` when an administrator changed it, `default` otherwise. */
  source: 'database' | 'default';
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Settings that change behaviour without a deploy. Values live in
 * SystemParameter; each instance keeps a snapshot refreshed every 30 s and
 * right after its own writes, so getters stay synchronous and cheap.
 */
@Injectable()
export class RuntimeSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeSettingsService.name);
  private snapshot = new Map<
    string,
    { value: unknown; updatedAt: Date; updatedBy: string | null }
  >();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly env: Envs;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(matchingConfig.KEY) matching: ConfigType<typeof matchingConfig>,
    @Inject(demandConfig.KEY) demand: ConfigType<typeof demandConfig>,
  ) {
    this.env = { matching, demand };
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get<K extends RuntimeSettingKey>(key: K): ValueOf<K> {
    const stored = this.snapshot.get(key);
    const definition = RUNTIME_SETTINGS[key];
    if (stored) {
      const parsed = definition.schema.safeParse(stored.value);
      if (parsed.success) return parsed.data as ValueOf<K>;
    }
    return definition.fallback(this.env) as ValueOf<K>;
  }

  list(): RuntimeSettingView[] {
    return (Object.keys(RUNTIME_SETTINGS) as RuntimeSettingKey[]).map((key) => {
      const definition = RUNTIME_SETTINGS[key];
      const stored = this.snapshot.get(key);
      return {
        key,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        valueType: definition.valueType,
        value: this.get(key),
        source: stored ? 'database' : 'default',
        updatedAt: stored?.updatedAt.toISOString() ?? null,
        updatedBy: stored?.updatedBy ?? null,
      };
    });
  }

  async update(
    actorUserId: string,
    key: string,
    value: unknown,
  ): Promise<RuntimeSettingView> {
    if (!(key in RUNTIME_SETTINGS)) {
      throw new NotFoundException({
        code: ERROR_CODES.RESOURCE_NOT_FOUND,
        message: `Unknown setting ${key}`,
      });
    }
    const settingKey = key as RuntimeSettingKey;
    const definition = RUNTIME_SETTINGS[settingKey];
    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `Invalid value for ${key}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
      });
    }

    const previous = this.get(settingKey);
    const stored =
      definition.valueType === SYSTEM_VALUE.JSON
        ? JSON.stringify(parsed.data)
        : `${parsed.data as string | number | boolean}`;

    await this.prisma.$transaction([
      this.prisma.systemParameter.upsert({
        where: { key },
        update: {
          value: stored,
          valueType: definition.valueType,
          updatedBy: actorUserId,
        },
        create: {
          key,
          value: stored,
          valueType: definition.valueType,
          description: definition.label,
          updatedBy: actorUserId,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId,
          action: 'SYSTEM_PARAMETER_UPDATED',
          entityType: 'SYSTEM_PARAMETER',
          entityId: key,
          oldValues: { key, value: JSON.stringify(previous) },
          newValues: { key, value: stored },
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
        },
      }),
    ]);

    await this.refresh();
    return this.list().find((setting) => setting.key === settingKey)!;
  }

  /** Re-reads every editable key. A failed read keeps the last snapshot. */
  async refresh(): Promise<void> {
    try {
      const rows = await this.prisma.systemParameter.findMany({
        where: { key: { in: Object.keys(RUNTIME_SETTINGS) } },
        include: { user: { select: { fullName: true } } },
      });
      const next = new Map<
        string,
        { value: unknown; updatedAt: Date; updatedBy: string | null }
      >();
      for (const row of rows) {
        next.set(row.key, {
          value: decode(row.valueType, row.value),
          updatedAt: row.updatedAt,
          updatedBy: row.user?.fullName ?? null,
        });
      }
      this.snapshot = next;
    } catch (error) {
      this.logger.warn(
        `Runtime settings refresh failed, keeping last values: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

function decode(valueType: SYSTEM_VALUE, raw: string): unknown {
  switch (valueType) {
    case SYSTEM_VALUE.BOOLEAN:
      return raw === 'true';
    case SYSTEM_VALUE.NUMBER:
      return Number(raw);
    case SYSTEM_VALUE.JSON:
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return undefined;
      }
    default:
      return raw;
  }
}
