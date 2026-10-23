import { revokeUserSessions } from './session-revocation';

type Client = Parameters<typeof revokeUserSessions>[0];

describe('revokeUserSessions', () => {
  function client(count = 2) {
    return {
      userSession: { updateMany: jest.fn().mockResolvedValue({ count }) },
    };
  }

  it('revokes every open session of the user through the given client', async () => {
    const tx = client(3);

    await expect(
      revokeUserSessions(tx as unknown as Client, 'user-1'),
    ).resolves.toBe(3);
    expect(tx.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as unknown },
    });
  });

  it('keeps the excepted session open', async () => {
    const tx = client();

    await revokeUserSessions(tx as unknown as Client, 'user-1', 'session-1');

    expect(tx.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null, id: { not: 'session-1' } },
      data: { revokedAt: expect.any(Date) as unknown },
    });
  });
});
