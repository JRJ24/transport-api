import 'dotenv/config';

import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { ROLES, SYSTEM_VALUE } from '../src/generated/prisma/enums';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is missing');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const ROLE_SEED: { code: ROLES; name: string; description: string }[] = [
  {
    code: ROLES.ADMIN,
    name: 'Administrador',
    description: 'Acceso completo al TMS y a la configuración del sistema',
  },
  {
    code: ROLES.OPERATOR,
    name: 'Operador',
    description: 'Gestión de solicitudes, despacho y monitoreo desde el TMS',
  },
  {
    code: ROLES.DRIVER,
    name: 'Conductor',
    description: 'Ejecución de servicios de transporte desde la app móvil',
  },
  {
    code: ROLES.CUSTOMER,
    name: 'Cliente',
    description: 'Solicitud y seguimiento de servicios de transporte',
  },
];

const VEHICLE_CATEGORY_SEED = [
  {
    code: 'MOTO',
    name: 'Motor',
    description: 'Entregas pequenas y documentos',
    maxWeightKg: 20,
    maxVolumenM3: 0.1,
    baseCapacityNote: 'Hasta 20kg',
    isActive: true,
  },
  {
    code: 'VAN',
    name: 'Van',
    description: 'Carga mediana urbana',
    maxWeightKg: 1200,
    maxVolumenM3: 8,
    baseCapacityNote: 'Hasta 1200kg / 8m3',
    isActive: true,
  },
  {
    code: 'CAMION',
    name: 'Camion',
    description: 'Carga pesada y mudanzas',
    maxWeightKg: 5000,
    maxVolumenM3: 30,
    baseCapacityNote: 'Hasta 5000kg / 30m3',
    isActive: true,
  },
];

const RATE_RULE_SEED: Record<
  string,
  {
    baseFare: number;
    pricePerKM: number;
    pricePerMinute: number;
    minimumFare: number;
    helperFee: number;
    nightFee: number;
    waitingPricePerMinute: number;
    cancellationFee: number;
  }
> = {
  MOTO: {
    baseFare: 120,
    pricePerKM: 18,
    pricePerMinute: 3,
    minimumFare: 180,
    helperFee: 0,
    nightFee: 75,
    waitingPricePerMinute: 5,
    cancellationFee: 100,
  },
  VAN: {
    baseFare: 250,
    pricePerKM: 35,
    pricePerMinute: 5,
    minimumFare: 350,
    helperFee: 150,
    nightFee: 100,
    waitingPricePerMinute: 10,
    cancellationFee: 200,
  },
  CAMION: {
    baseFare: 900,
    pricePerKM: 80,
    pricePerMinute: 12,
    minimumFare: 1200,
    helperFee: 300,
    nightFee: 250,
    waitingPricePerMinute: 20,
    cancellationFee: 500,
  },
};

const CATALOG_SEED = [
  { groupKey: 'payment-methods', code: 'CARD', label: 'Tarjeta', sortOrder: 1 },
  {
    groupKey: 'payment-methods',
    code: 'CASH',
    label: 'Efectivo',
    sortOrder: 2,
  },
  { groupKey: 'incident-severity', code: 'LOW', label: 'Baja', sortOrder: 1 },
  {
    groupKey: 'incident-severity',
    code: 'MEDIUM',
    label: 'Media',
    sortOrder: 2,
  },
  { groupKey: 'incident-severity', code: 'HIGH', label: 'Alta', sortOrder: 3 },
];

async function main(): Promise<void> {
  for (const role of ROLE_SEED) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }
  console.log(`Seeded ${ROLE_SEED.length} roles`);

  const adminEmail = (
    process.env.ADMIN_EMAIL ?? 'admin@rutard.local'
  ).toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin123!ChangeMe';
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);

  const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      fullName: 'Administrador RUTA RD',
      email: adminEmail,
      phone: process.env.ADMIN_PHONE ?? '+18090000000',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { code: ROLES.ADMIN },
  });

  const hasRole = await prisma.userRole.findFirst({
    where: { userID: admin.id, roleID: adminRole.id },
  });

  if (!hasRole) {
    await prisma.userRole.create({
      data: { userID: admin.id, roleID: adminRole.id },
    });
  }

  console.log(`Admin user ready: ${adminEmail}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      'ADMIN_PASSWORD not set — the admin was created with the default dev password. Change it before deploying.',
    );
  }

  const categoryIds = new Map<string, string>();

  for (const category of VEHICLE_CATEGORY_SEED) {
    const saved = await prisma.vehicleCategory.upsert({
      where: { code: category.code },
      update: category,
      create: category,
    });
    categoryIds.set(category.code, saved.id);
  }
  console.log(`Seeded ${VEHICLE_CATEGORY_SEED.length} vehicle categories`);

  let rateCard = await prisma.rateCard.findFirst({
    where: { name: 'Tarifa base V1 interna' },
  });

  rateCard ??= await prisma.rateCard.create({
    data: {
      name: 'Tarifa base V1 interna',
      description: 'Tarifa inicial para cotizaciones internas/mock',
      validForm: new Date('2026-01-01T00:00:00.000Z'),
      validTo: null,
      isActive: true,
    },
  });

  for (const [code, rule] of Object.entries(RATE_RULE_SEED)) {
    const vehicleCategoryId = categoryIds.get(code);

    if (!vehicleCategoryId) {
      continue;
    }

    const existingRule = await prisma.rateRule.findFirst({
      where: { rateCardId: rateCard.id, vehicleCategoryId },
    });

    if (existingRule) {
      await prisma.rateRule.update({
        where: { id: existingRule.id },
        data: rule,
      });
    } else {
      await prisma.rateRule.create({
        data: {
          rateCardId: rateCard.id,
          vehicleCategoryId,
          ...rule,
          createdAt: new Date(),
        },
      });
    }
  }
  console.log(`Seeded ${Object.keys(RATE_RULE_SEED).length} rate rules`);

  for (const catalog of CATALOG_SEED) {
    const existingCatalog = await prisma.catalog.findFirst({
      where: { groupKey: catalog.groupKey, code: catalog.code },
    });

    if (existingCatalog) {
      await prisma.catalog.update({
        where: { id: existingCatalog.id },
        data: { label: catalog.label, sortOrder: catalog.sortOrder },
      });
    } else {
      await prisma.catalog.create({ data: { ...catalog, isActive: true } });
    }
  }
  console.log(`Seeded ${CATALOG_SEED.length} catalog items`);

  await prisma.systemParameter.upsert({
    where: { key: 'tax.rate' },
    update: {
      value: '0.18',
      valueType: SYSTEM_VALUE.NUMBER,
      description: 'ITBIS usado por cotizaciones internas/mock',
      updatedBy: admin.id,
    },
    create: {
      key: 'tax.rate',
      value: '0.18',
      valueType: SYSTEM_VALUE.NUMBER,
      description: 'ITBIS usado por cotizaciones internas/mock',
      updatedBy: admin.id,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
