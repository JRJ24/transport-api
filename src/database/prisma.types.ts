import type { PrismaClient } from '@generated/prisma/client';

export type { Prisma } from '@generated/prisma/client';

/**
 * Client shape available inside interactive transactions
 * (prisma.$transaction(async (tx) => ...)).
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
