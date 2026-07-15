import type { ROLES, STATUS_ACCOUNT } from '@generated/prisma/enums';
import type { Permission } from '../enums/permission.enum';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  status: STATUS_ACCOUNT;
  roles: ROLES[];
  permissions: Permission[];
  sessionId: string;
}
