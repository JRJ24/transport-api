import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES } from '@generated/prisma/enums';
import { ERROR_CODES } from '../constants/error-codes.constant';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Permission } from '../enums/permission.enum';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';

const permission = Object.values(Permission)[0];

class Routes {
  @SetMetadata(ROLES_KEY, [ROLES.ADMIN])
  adminOnly() {}

  @SetMetadata(PERMISSIONS_KEY, [permission])
  needsPermission() {}

  open() {}
}

function context(
  handler: keyof Routes,
  user?: Partial<AuthenticatedUser>,
): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { getResponse(): { code?: string } }).getResponse().code;
  }
  return undefined;
};

describe('RolesGuard and PermissionsGuard fail closed (SEC-API-012)', () => {
  const reflector = new Reflector();
  const roles = new RolesGuard(reflector);
  const permissions = new PermissionsGuard(reflector);

  it('refuses a route that requires a role when there is no user', () => {
    expect(codeOf(() => roles.canActivate(context('adminOnly')))).toBe(
      ERROR_CODES.FORBIDDEN_ROLE,
    );
  });

  it('refuses a route that requires a permission when there is no user', () => {
    expect(
      codeOf(() => permissions.canActivate(context('needsPermission'))),
    ).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);
  });

  it('lets through a route that requires nothing, without a user', () => {
    expect(roles.canActivate(context('open'))).toBe(true);
    expect(permissions.canActivate(context('open'))).toBe(true);
  });

  it('keeps today’s behaviour for authenticated users', () => {
    expect(
      roles.canActivate(context('adminOnly', { roles: [ROLES.ADMIN] })),
    ).toBe(true);
    expect(
      codeOf(() =>
        roles.canActivate(context('adminOnly', { roles: [ROLES.CUSTOMER] })),
      ),
    ).toBe(ERROR_CODES.FORBIDDEN_ROLE);
    expect(
      permissions.canActivate(
        context('needsPermission', { permissions: [permission] }),
      ),
    ).toBe(true);
    expect(
      codeOf(() =>
        permissions.canActivate(
          context('needsPermission', { permissions: [] }),
        ),
      ),
    ).toBe(ERROR_CODES.FORBIDDEN_PERMISSION);
  });
});
