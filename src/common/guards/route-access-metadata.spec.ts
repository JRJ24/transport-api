import { readdirSync } from 'fs';
import { join } from 'path';
import { Controller, Get, Post } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES } from '@generated/prisma/enums';
import {
  Permissions,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY, Public } from '../decorators/public.decorator';
import { Roles, ROLES_KEY } from '../decorators/roles.decorator';
import { Permission } from '../enums/permission.enum';

type ControllerClass = abstract new (...args: never[]) => unknown;

/**
 * Same precedence as Reflector.getAllAndOverride([handler, class]): the
 * handler's metadata wins, otherwise the class's.
 */
function effective(key: string, handler: object, controller: object): unknown {
  return (
    (Reflect.getMetadata(key, handler) as unknown) ??
    (Reflect.getMetadata(key, controller) as unknown)
  );
}

const requires = (value: unknown): boolean =>
  Array.isArray(value) && value.length > 0;

/** Routes that are @Public() and still require roles or permissions. */
function findPublicRoutesRequiringAccess(
  controllers: ControllerClass[],
): string[] {
  const offenders: string[] = [];

  for (const controller of controllers) {
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (
        name === 'constructor' ||
        typeof handler !== 'function' ||
        Reflect.getMetadata(METHOD_METADATA, handler) === undefined
      ) {
        continue;
      }
      const isPublic = effective(IS_PUBLIC_KEY, handler, controller) === true;
      if (
        isPublic &&
        (requires(effective(ROLES_KEY, handler, controller)) ||
          requires(effective(PERMISSIONS_KEY, handler, controller)))
      ) {
        offenders.push(`${controller.name}.${name}`);
      }
    }
  }

  return offenders;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : controllerFiles(path);
    }
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

async function loadAppControllers(): Promise<ControllerClass[]> {
  const modules = await Promise.all(
    controllerFiles(join(__dirname, '..', '..')).map(
      (file) => import(file) as Promise<Record<string, unknown>>,
    ),
  );
  return modules.flatMap((exports) =>
    Object.values(exports).filter(
      (value): value is ControllerClass =>
        typeof value === 'function' &&
        Reflect.getMetadata(PATH_METADATA, value) !== undefined,
    ),
  );
}

@Public()
@Controller('fake-public-class')
class PublicClassWithAdminRoute {
  @Get()
  list() {}

  @Roles(ROLES.ADMIN)
  @Post()
  create() {}
}

@Controller('fake-mixed-method')
class PublicMethodWithPermission {
  @Public()
  @Permissions(Permission.MANAGE_USERS)
  @Get()
  read() {}
}

@Controller('fake-clean')
class CleanController {
  @Public()
  @Get()
  health() {}

  @Roles(ROLES.ADMIN)
  @Post()
  create() {}
}

describe('findPublicRoutesRequiringAccess (SEC-API-012)', () => {
  it('flags a role route inside a @Public() class', () => {
    expect(
      findPublicRoutesRequiringAccess([PublicClassWithAdminRoute]),
    ).toEqual(['PublicClassWithAdminRoute.create']);
  });

  it('flags a @Public() method that also requires a permission', () => {
    expect(
      findPublicRoutesRequiringAccess([PublicMethodWithPermission]),
    ).toEqual(['PublicMethodWithPermission.read']);
  });

  it('accepts public and protected routes kept apart', () => {
    expect(findPublicRoutesRequiringAccess([CleanController])).toEqual([]);
  });

  it('finds no such route among the real controllers', async () => {
    const controllers = await loadAppControllers();

    // Guards against a silent pass if the files stop being found.
    expect(controllers.length).toBeGreaterThanOrEqual(40);
    expect(findPublicRoutesRequiringAccess(controllers)).toEqual([]);
  });
});
