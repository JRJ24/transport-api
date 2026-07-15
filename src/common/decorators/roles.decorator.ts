import { SetMetadata } from '@nestjs/common';
import type { ROLES } from '@generated/prisma/enums';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to users that hold at least one of the given roles.
 */
export const Roles = (...roles: ROLES[]) => SetMetadata(ROLES_KEY, roles);
