import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '../constants/error-codes.constant';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { Permission } from '../enums/permission.enum';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<
      Permission[] | undefined
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      return true;
    }

    const hasAll = requiredPermissions.every((permission) =>
      user.permissions.includes(permission),
    );

    if (!hasAll) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN_PERMISSION,
        message: 'You do not have the required permissions for this action',
      });
    }

    return true;
  }
}
