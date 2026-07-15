import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../enums/permission.enum';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Restricts a route to users that hold ALL of the given permissions.
 */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
