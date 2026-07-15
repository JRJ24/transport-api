import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { STATUS_ACCOUNT } from '@generated/prisma/enums';
import { ERROR_CODES } from '../constants/error-codes.constant';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class AccountStatusGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    // Authentication itself is enforced by JwtAuthGuard.
    if (!user) {
      return true;
    }

    if (user.status === STATUS_ACCOUNT.BLOCKED) {
      throw new ForbiddenException({
        code: ERROR_CODES.ACCOUNT_BLOCKED,
        message: 'Account is blocked',
      });
    }

    if (user.status !== STATUS_ACCOUNT.ACTIVE) {
      throw new ForbiddenException({
        code: ERROR_CODES.ACCOUNT_INACTIVE,
        message: 'Account is not active',
      });
    }

    return true;
  }
}
