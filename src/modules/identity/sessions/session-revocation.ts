import type { Prisma } from '@generated/prisma/client';

/**
 * Revokes every open session of a user. Takes the Prisma client to run on, so
 * callers can revoke inside the same transaction that changes the account
 * status and never leave a blocked account with live sessions.
 */
export async function revokeUserSessions(
  client: Pick<Prisma.TransactionClient, 'userSession'>,
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const result = await client.userSession.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId && { id: { not: exceptSessionId } }),
    },
    data: { revokedAt: new Date() },
  });

  return result.count;
}
