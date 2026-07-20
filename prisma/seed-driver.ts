import 'dotenv/config';

import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  ASSIGNMENT_STATUS,
  DOCUMENT_TYPE,
  PAYMENT_STATUS,
  ROLES,
  SERVICE_TYPE,
  STATUS_DRIVER,
  STATUS_ORDERS,
  STATUS_VEHICLE,
  STOP_TYPE,
  TYPE_CUSTOMER,
  VERIFICATION_STATUS,
} from '../src/generated/prisma/enums';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is missing');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const DRIVER_EMAIL = 'driver@rutard.local';
const DRIVER_PASSWORD = 'Driver123!';
const CUSTOMER_EMAIL = 'cliente@rutard.local';
const CUSTOMER_PASSWORD = 'Customer123!';

async function main() {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);
  const now = new Date();

  const driverRole = await prisma.role.findUnique({ where: { code: ROLES.DRIVER } });
  const customerRole = await prisma.role.findUnique({
    where: { code: ROLES.CUSTOMER },
  });
  if (!driverRole || !customerRole) {
    throw new Error('Run the base seed first (pnpm run db:seed) to create roles.');
  }

  // ── Driver user + role + profile ──────────────────────────────────────────
  const driverUser = await prisma.user.upsert({
    where: { email: DRIVER_EMAIL },
    update: {},
    create: {
      fullName: 'Juan Pérez',
      email: DRIVER_EMAIL,
      phone: '+18299990001',
      passwordHash: await bcrypt.hash(DRIVER_PASSWORD, saltRounds),
    },
  });
  await ensureRole(driverUser.id, driverRole.id);

  let driver = await prisma.driverProfile.findFirst({
    where: { userId: driverUser.id },
  });
  driver ??= await prisma.driverProfile.create({
    data: {
      userId: driverUser.id,
      licenseNumber: 'LIC-001-RD',
      licenseExpiration: new Date(now.getFullYear() + 2, 0, 1),
      availabilityStatus: STATUS_DRIVER.AVAILABLE,
      verificationStatus: VERIFICATION_STATUS.APPROVED,
      ratingAVG: 4.9,
    },
  });

  // ── Customer user + role + profile ────────────────────────────────────────
  const customerUser = await prisma.user.upsert({
    where: { email: CUSTOMER_EMAIL },
    update: {},
    create: {
      fullName: 'María Rodríguez',
      email: CUSTOMER_EMAIL,
      phone: '+18299990002',
      passwordHash: await bcrypt.hash(CUSTOMER_PASSWORD, saltRounds),
    },
  });
  await ensureRole(customerUser.id, customerRole.id);

  let customer = await prisma.customerProfile.findFirst({
    where: { userId: customerUser.id },
  });
  customer ??= await prisma.customerProfile.create({
    data: {
      userId: customerUser.id,
      customerType: TYPE_CUSTOMER.INDIVIDUAL,
      documentType: DOCUMENT_TYPE.ID,
      documentNumber: '001-0000000-1',
      createdAt: now,
    },
  });

  // ── Vehicle category + vehicle ────────────────────────────────────────────
  let category = await prisma.vehicleCategory.findFirst();
  category ??= await prisma.vehicleCategory.create({
    data: {
      code: 'SMALL_TRUCK',
      name: 'Camión pequeño',
      description: 'Camión pequeño para paquetería',
      maxWeightKg: 1000,
      maxVolumenM3: 8,
      baseCapacityNote: 'Hasta 1 ton',
      isActive: true,
    },
  });

  const vehicle = await prisma.vehicle.upsert({
    where: { plateNumber: 'L342991' },
    update: {},
    create: {
      driverId: driver.id,
      categoryId: category.id,
      plateNumber: 'L342991',
      brand: 'Isuzu',
      model: 'NPR',
      year: 2022,
      color: 'Blanco',
      status: STATUS_VEHICLE.ACTIVE,
      createdAt: now,
    },
  });

  // ── Sample order + stops + item + assignment (only if none pending) ────────
  const existing = await prisma.orderAssignment.findFirst({
    where: {
      driverId: driver.id,
      assignmentStatus: { in: [ASSIGNMENT_STATUS.PENDING, ASSIGNMENT_STATUS.ACCEPTED] },
    },
  });

  if (!existing) {
    const quote = await prisma.priceQuote.create({
      data: {
        customerId: customer.id,
        vehicleCategoryId: category.id,
        originAddress: 'Av. Winston Churchill 14, Piantini',
        destinationAddress: 'Av. España 42, Santo Domingo Este',
        distanceKm: 8.4,
        estimatedDurationMin: 24,
        baseAmount: 1000,
        extrasAmount: 0,
        demandAmount: 0,
        weatherAmount: 0,
        taxAmount: 240,
        totalAmount: 1240,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    });

    const order = await prisma.transportOrder.create({
      data: {
        orderCode: `RD-${now.getTime().toString().slice(-4)}`,
        customerId: customer.id,
        quoteId: quote.id,
        vehicleCategoryId: category.id,
        serviceType: SERVICE_TYPE.INMEDIATE,
        status: STATUS_ORDERS.ASSIGNED,
        distanceKm: 8.4,
        estimatedDurationMin: 24,
        totalAmount: 1240,
        paymentStatus: PAYMENT_STATUS.PENDING,
        notes: 'Farmacia y documento — validar sello antes de salir.',
        orderStops: {
          create: [
            {
              stopType: STOP_TYPE.PICKUP,
              sequence: 1,
              contactName: 'Farmacia Carol',
              contactPhone: '+18095550001',
              addressLine: 'Av. Abraham Lincoln 1009, acceso norte',
              city: 'Santo Domingo',
              province: 'Distrito Nacional',
              latitude: 18.4719,
              longitude: -69.9412,
              instructions: 'Recoger en mostrador, validar sello.',
            },
            {
              stopType: STOP_TYPE.DROPOFF,
              sequence: 2,
              contactName: 'Mariela Santos',
              contactPhone: '+18095550184',
              addressLine: 'Av. España 42, SDE',
              city: 'Santo Domingo Este',
              province: 'Santo Domingo',
              latitude: 18.4301,
              longitude: -69.6689,
            },
          ],
        },
        orderItems: {
          create: {
            description: 'Cajas de medicamento',
            quantity: 4,
            weightKg: 120,
            fragile: true,
            requireHelper: false,
          },
        },
      },
    });

    await prisma.orderAssignment.create({
      data: {
        orderId: order.id,
        driverId: driver.id,
        vehicleId: vehicle.id,
        assignmentStatus: ASSIGNMENT_STATUS.PENDING,
      },
    });

    console.log(`Sample order created: ${order.orderCode}`);
  } else {
    console.log('Driver already has a pending/accepted assignment — skipping order.');
  }

  console.log('\n✅ Driver seed ready');
  console.log(`   Conductor: ${DRIVER_EMAIL} / ${DRIVER_PASSWORD}`);
  console.log(`   Cliente:   ${CUSTOMER_EMAIL} / ${CUSTOMER_PASSWORD}`);
}

async function ensureRole(userId: string, roleId: string): Promise<void> {
  const existing = await prisma.userRole.findFirst({
    where: { userID: userId, roleID: roleId },
  });
  if (!existing) {
    await prisma.userRole.create({
      data: { userID: userId, roleID: roleId },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
