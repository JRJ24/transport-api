import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import type { authConfig, notificationConfig } from '@/config';
import type { PrismaService } from '@/database/prisma.service';
import type { SessionsService } from '../sessions/sessions.service';
import { AccountService } from './account.service';

const user = {
  id: 'user-1',
  sessionId: 'session-current',
  email: 'ana@example.com',
} as AuthenticatedUser;

async function setup(options: { smtp?: boolean; emailTaken?: boolean } = {}) {
  const passwordHash = await bcrypt.hash('OldPass123', 4);
  let storedRequest: Record<string, unknown> | null = null;

  const prisma = {
    user: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ passwordHash, email: 'ana@example.com' }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(options.emailTaken ? 1 : 0),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    emailChangeRequest: {
      // Conditional writes on the stored request, like Postgres updateMany:
      // only applies (and counts) when every condition in `where` holds.
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: {
            id?: string;
            consumedAt?: null;
            attempts?: { lt: number };
          };
          data: {
            attempts?: { increment: number };
            consumedAt?: Date;
          };
        }) => {
          const request = storedRequest as {
            id: string;
            attempts: number;
            consumedAt?: Date | null;
          } | null;
          const matches =
            request !== null &&
            (where.id === undefined || where.id === request.id) &&
            (where.consumedAt === undefined || !request.consumedAt) &&
            (where.attempts === undefined ||
              request.attempts < where.attempts.lt);
          if (!matches) {
            return Promise.resolve({ count: 0 });
          }
          if (data.attempts) {
            request.attempts += data.attempts.increment;
          }
          if (data.consumedAt) {
            request.consumedAt = data.consumedAt;
          }
          return Promise.resolve({ count: 1 });
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        storedRequest = { id: 'req-1', attempts: 0, ...data };
        return storedRequest;
      }),
      // Yields first, so parallel confirmations interleave like real queries.
      findFirst: jest.fn(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return storedRequest ? { ...storedRequest } : null;
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  const sessions = {
    revokeAllForUser: jest.fn().mockResolvedValue(2),
  } as unknown as SessionsService;
  const service = new AccountService(
    prisma,
    sessions,
    { bcryptSaltRounds: 4 } as ReturnType<typeof authConfig>,
    {
      smtpHost: options.smtp ? 'smtp.test' : '',
      smtpPort: 587,
      smtpUser: '',
      smtpPassword: '',
      emailFrom: 'no-reply@test',
    } as ReturnType<typeof notificationConfig>,
  );
  // Never talk to a real SMTP server from tests.
  const sent: { to: string; code: string }[] = [];
  jest
    .spyOn(service as unknown as { sendCode: () => Promise<void> }, 'sendCode')
    .mockImplementation(((to: string, code: string) => {
      sent.push({ to, code });
      return Promise.resolve();
    }) as never);

  return { service, prisma, sessions, sent };
}

describe('AccountService.changePassword', () => {
  it('changes the password and signs out the other devices only', async () => {
    const { service, prisma, sessions } = await setup();

    const result = await service.changePassword(
      user,
      'OldPass123',
      'NewPass456',
    );

    expect(result).toEqual({ revokedSessions: 2 });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
      'user-1',
      'session-current',
    );
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(await bcrypt.compare('NewPass456', data.passwordHash)).toBe(true);
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('refuses a wrong current password without touching anything', async () => {
    const { service, prisma, sessions } = await setup();

    await expect(
      service.changePassword(user, 'nope', 'NewPass456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('refuses reusing the same password', async () => {
    const { service } = await setup();

    await expect(
      service.changePassword(user, 'OldPass123', 'OldPass123'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AccountService email change', () => {
  it('applies directly when no SMTP is configured', async () => {
    const { service, prisma } = await setup();

    const result = await service.requestEmailChange(
      user,
      'Nuevo@Empresa.com',
      'OldPass123',
    );

    expect(result).toEqual({ status: 'CHANGED', email: 'nuevo@empresa.com' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { email: 'nuevo@empresa.com' },
    });
  });

  it('sends a code and changes only after confirming it', async () => {
    const { service, prisma, sent } = await setup({ smtp: true });

    const requested = await service.requestEmailChange(
      user,
      'nuevo@empresa.com',
      'OldPass123',
    );
    expect(requested.status).toBe('CODE_SENT');
    expect(prisma.user.update).not.toHaveBeenCalled();

    await expect(
      service.confirmEmailChange(
        user,
        '000000' === sent[0].code ? '111111' : '000000',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const confirmed = await service.confirmEmailChange(user, sent[0].code);
    expect(confirmed).toEqual({
      status: 'CHANGED',
      email: 'nuevo@empresa.com',
    });
  });

  it('refuses an email that belongs to someone else', async () => {
    const { service } = await setup({ emailTaken: true });

    await expect(
      service.requestEmailChange(user, 'otro@empresa.com', 'OldPass123'),
    ).rejects.toThrow(/already registered/);
  });
});

describe('AccountService.setAvatar', () => {
  it('rejects non-images and oversized files', async () => {
    const { service } = await setup();
    const req = {} as never;

    await expect(
      service.setAvatar(
        user,
        { buffer: Buffer.from('x'), mimetype: 'application/pdf', size: 10 },
        req,
      ),
    ).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(
      service.setAvatar(
        user,
        {
          buffer: Buffer.from('x'),
          mimetype: 'image/png',
          size: 3 * 1024 * 1024,
        },
        req,
      ),
    ).rejects.toThrow(/2 MB/);
    await expect(service.setAvatar(user, undefined, req)).rejects.toThrow(
      /Attach an image/,
    );
  });
});

describe('AccountService email code attempts under concurrency (SEC-API-020)', () => {
  async function codeSent() {
    const ctx = await setup({ smtp: true });
    await ctx.service.requestEmailChange(
      user,
      'nuevo@empresa.com',
      'OldPass123',
    );
    const right = ctx.sent[0].code;
    const wrong = right === '000000' ? '111111' : '000000';
    // The request the mock keeps; updateMany mutates this same object.
    const stored = () =>
      (ctx.prisma.emailChangeRequest.create as jest.Mock).mock.results[0]
        .value as { attempts: number };
    return { ...ctx, right, wrong, stored };
  }

  const messages = (results: PromiseSettledResult<unknown>[]) =>
    results
      .map((result) =>
        result.status === 'rejected'
          ? (result.reason as Error).message
          : 'CHANGED',
      )
      .sort();

  it('evaluates only one of two parallel wrong codes when one attempt is left', async () => {
    const { service, wrong, stored } = await codeSent();
    stored().attempts = 4;

    const results = await Promise.allSettled([
      service.confirmEmailChange(user, wrong),
      service.confirmEmailChange(user, wrong),
    ]);

    expect(messages(results)).toEqual([
      'The code expired; request a new one',
      'The code is not correct',
    ]);
    expect(stored().attempts).toBe(5);
  });

  it('refuses even the right code once the five attempts are used', async () => {
    const { service, right, stored } = await codeSent();
    stored().attempts = 5;

    await expect(service.confirmEmailChange(user, right)).rejects.toThrow(
      'The code expired; request a new one',
    );
  });

  it('applies a right code only once when it is confirmed twice at once', async () => {
    const { service, prisma, right } = await codeSent();

    const results = await Promise.allSettled([
      service.confirmEmailChange(user, right),
      service.confirmEmailChange(user, right),
    ]);

    expect(messages(results)).toEqual([
      'CHANGED',
      'The code expired; request a new one',
    ]);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
