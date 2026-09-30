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
      updateMany: jest.fn().mockReturnValue({}),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        storedRequest = { id: 'req-1', attempts: 0, ...data };
        return storedRequest;
      }),
      findFirst: jest.fn(() => Promise.resolve(storedRequest)),
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
