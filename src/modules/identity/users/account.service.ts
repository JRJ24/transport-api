import { createHash, randomInt } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import nodemailer from 'nodemailer';
import sharp from 'sharp';
import { ERROR_CODES } from '@/common/constants/error-codes.constant';
import type { AuthenticatedUser } from '@/common/interfaces/authenticated-user.interface';
import { storeObject } from '@/common/middlewares/processFile';
import { hashPassword, verifyPassword } from '@/common/utils/hash.util';
import { authConfig, notificationConfig } from '@/config';
import { PrismaService } from '@/database/prisma.service';
import { SessionsService } from '../sessions/sessions.service';

const EMAIL_CODE_TTL_MS = 15 * 60_000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export type EmailChangeResult =
  | { status: 'CODE_SENT'; sentTo: string; expiresAt: string }
  | { status: 'CHANGED'; email: string };

const hashCode = (code: string) =>
  createHash('sha256').update(code).digest('hex');

/**
 * Self-service account security for any signed-in user: password, email and
 * avatar. Everything that changes credentials asks for the current password
 * and is written to the audit log.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
    @Inject(notificationConfig.KEY)
    private readonly mail: ConfigType<typeof notificationConfig>,
  ) {}

  /**
   * Changes the password and signs out every other device: whoever knew the
   * old password must not keep a session.
   */
  async changePassword(
    user: AuthenticatedUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ revokedSessions: number }> {
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    await this.assertPassword(currentPassword, account.passwordHash);
    if (await verifyPassword(newPassword, account.passwordHash)) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'The new password must be different from the current one',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(
          newPassword,
          this.auth.bcryptSaltRounds,
        ),
      },
    });
    const revokedSessions = await this.sessions.revokeAllForUser(
      user.id,
      user.sessionId,
    );
    await this.audit(user.id, 'USER_PASSWORD_CHANGED', { revokedSessions });
    return { revokedSessions };
  }

  /**
   * Starts an email change. With SMTP configured a 6-digit code goes to the
   * new address and nothing changes until it is confirmed; without SMTP (dev)
   * the change is applied directly after the password check.
   */
  async requestEmailChange(
    user: AuthenticatedUser,
    newEmailRaw: string,
    password: string,
  ): Promise<EmailChangeResult> {
    const newEmail = newEmailRaw.toLowerCase().trim();
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, email: true },
    });
    await this.assertPassword(password, account.passwordHash);
    if (newEmail === account.email) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'That is already your email',
      });
    }
    await this.assertEmailFree(newEmail);

    if (!this.mail.smtpHost) {
      await this.applyEmail(user.id, account.email, newEmail);
      return { status: 'CHANGED', email: newEmail };
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
    await this.prisma.$transaction([
      // Only the latest request counts.
      this.prisma.emailChangeRequest.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.emailChangeRequest.create({
        data: {
          userId: user.id,
          newEmail,
          codeHash: hashCode(code),
          expiresAt,
        },
      }),
    ]);
    await this.sendCode(newEmail, code);
    return {
      status: 'CODE_SENT',
      sentTo: newEmail,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async confirmEmailChange(
    user: AuthenticatedUser,
    code: string,
  ): Promise<EmailChangeResult> {
    const request = await this.prisma.emailChangeRequest.findFirst({
      where: {
        userId: user.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!request || request.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'The code expired; request a new one',
      });
    }
    if (request.codeHash !== hashCode(code)) {
      await this.prisma.emailChangeRequest.update({
        where: { id: request.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'The code is not correct',
      });
    }

    await this.assertEmailFree(request.newEmail);
    const account = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true },
    });
    await this.prisma.emailChangeRequest.update({
      where: { id: request.id },
      data: { consumedAt: new Date() },
    });
    await this.applyEmail(user.id, account.email, request.newEmail);
    return { status: 'CHANGED', email: request.newEmail };
  }

  /** Square 256 px WebP; the previous file is simply no longer referenced. */
  async setAvatar(
    user: AuthenticatedUser,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    req: Request,
  ): Promise<{ avatarUrl: string }> {
    if (!file) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'Attach an image in the "file" field',
      });
    }
    if (!AVATAR_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'The avatar must be a JPG, PNG or WebP image',
      });
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'The avatar must be 2 MB or smaller',
      });
    }

    let body: Buffer;
    try {
      body = await sharp(file.buffer)
        .rotate()
        .resize(256, 256, { fit: 'cover' })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException({
        code: ERROR_CODES.BAD_REQUEST,
        message: 'The image could not be read',
      });
    }

    const avatarUrl = await storeObject({
      key: `avatars/${user.id}-${Date.now()}.webp`,
      body,
      contentType: 'image/webp',
      req,
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl },
    });
    return { avatarUrl };
  }

  async removeAvatar(user: AuthenticatedUser): Promise<void> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: null },
    });
  }

  private async assertPassword(plain: string, hash: string): Promise<void> {
    if (!(await verifyPassword(plain, hash))) {
      throw new UnauthorizedException({
        code: ERROR_CODES.INVALID_CREDENTIALS,
        message: 'The current password is not correct',
      });
    }
  }

  private async assertEmailFree(email: string): Promise<void> {
    const taken = await this.prisma.user.count({ where: { email } });
    if (taken > 0) {
      throw new ConflictException({
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'That email is already registered',
      });
    }
  }

  private async applyEmail(
    userId: string,
    previous: string,
    next: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { email: next },
    });
    await this.audit(userId, 'USER_EMAIL_CHANGED', { previous, next });
  }

  private async sendCode(to: string, code: string): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.mail.smtpHost,
      port: this.mail.smtpPort,
      secure: this.mail.smtpPort === 465,
      auth:
        this.mail.smtpUser && this.mail.smtpPassword
          ? { user: this.mail.smtpUser, pass: this.mail.smtpPassword }
          : undefined,
    });
    try {
      await transporter.sendMail({
        from: this.mail.emailFrom,
        to,
        subject: 'RUTA RD: confirma tu nuevo correo',
        text: `Tu codigo para confirmar el cambio de correo es ${code}. Vence en 15 minutos. Si no lo pediste, ignora este mensaje.`,
      });
    } catch (error) {
      this.logger.error(
        `Email change code not sent: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new BadRequestException({
        code: ERROR_CODES.UPSTREAM_ERROR,
        message: 'The confirmation email could not be sent; try again later',
      });
    }
  }

  private async audit(
    userId: string,
    action: string,
    newValues: Record<string, string | number>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action,
        entityType: 'USER',
        entityId: userId,
        newValues,
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      },
    });
  }
}
