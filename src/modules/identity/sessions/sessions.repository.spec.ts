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
