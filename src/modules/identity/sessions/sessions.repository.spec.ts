import type { PrismaService } from '@/database/prisma.service';
import { SessionsRepository } from './sessions.repository';

describe('SessionsRepository.rotateRefreshToken', () => {
  it('keeps the atomic condition and records the replaced hash and rotation time', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { userSession: { updateMany } } as unknown as PrismaService;
    const repository = new SessionsRepository(prisma);
    const expiresAt = new Date('2026-11-01T00:00:00Z');
    const rotatedAt = new Date('2026-10-23T12:00:00Z');

    const count = await repository.rotateRefreshToken({
      sessionId: 'session-1',
      currentHash: 'hash-old',
      nextHash: 'hash-new',
      expiresAt,
      rotatedAt,
    });

    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        refreshTokenHash: 'hash-old',
        revokedAt: null,
      },
      data: expect.objectContaining({
        refreshTokenHash: 'hash-new',
        previousRefreshTokenHash: 'hash-old',
        refreshRotatedAt: rotatedAt,
        expiresAt,
      }) as unknown,
    });
  });
});

describe('SessionsRepository session lifetime cap (SEC-API-018)', () => {
  it('only finds sessions created after the cutoff', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      userSession: { findFirst, findMany },
    } as unknown as PrismaService;
    const repository = new SessionsRepository(prisma);
    const cutoff = new Date('2026-07-25T00:00:00Z');

    await repository.findValidWithUser('session-1', cutoff);
    await repository.listActiveForUser('user-1', cutoff);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'session-1',
          createdAt: { gt: cutoff },
        }) as unknown,
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          createdAt: { gt: cutoff },
        }) as unknown,
      }),
    );
  });
});
