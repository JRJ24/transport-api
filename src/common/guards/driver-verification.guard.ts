import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES, VERIFICATION_STATUS } from '@generated/prisma/enums';
import { ERROR_CODES } from '../constants/error-codes.constant';
import { ALLOW_UNVERIFIED_DRIVER_KEY } from '../decorators/allow-unverified-driver.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class DriverVerificationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const allowUnverified = this.reflector.getAllAndOverride<boolean>(
      ALLOW_UNVERIFIED_DRIVER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic || allowUnverified) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || !user.roles.includes(ROLES.DRIVER)) {
      return true;
    }

    const driver = await this.prisma.driverProfile.findFirst({
      where: { userId: user.id },
      select: { verificationStatus: true },
    });

    if (driver?.verificationStatus === VERIFICATION_STATUS.APPROVED) {
      return true;
    }

    throw new ForbiddenException({
      code: ERROR_CODES.FORBIDDEN,
      message: 'Driver profile is pending approval',
      details: {
        verificationStatus:
          driver?.verificationStatus ?? VERIFICATION_STATUS.PENDING,
      },
    });
  }
}
