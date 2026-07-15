import type { Role, User, UserRole } from '@generated/prisma/client';
import type { ROLES, STATUS_ACCOUNT } from '@generated/prisma/enums';

export type UserWithRoles = User & {
  userRoles: (UserRole & { rol: Role })[];
};

export interface UserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  status: STATUS_ACCOUNT;
  roles: ROLES[];
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toUserResponse(user: UserWithRoles): UserResponse {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    status: user.status,
    roles: user.userRoles.map((userRole) => userRole.rol.code),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}
