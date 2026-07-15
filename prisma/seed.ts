import 'dotenv/config';

import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { ROLES } from '../generated/prisma/enums';

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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
