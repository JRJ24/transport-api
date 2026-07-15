import { ROLES } from '@generated/prisma/enums';

export enum Permission {
  MANAGE_USERS = 'users:manage',
  VIEW_USERS = 'users:view',
  MANAGE_ROLES = 'roles:manage',
  MANAGE_SESSIONS = 'sessions:manage',
  MANAGE_DRIVERS = 'drivers:manage',
  MANAGE_VEHICLES = 'vehicles:manage',
  MANAGE_PRICING = 'pricing:manage',
  CREATE_ORDERS = 'orders:create',
  VIEW_ORDERS = 'orders:view',
  MANAGE_ORDERS = 'orders:manage',
  ASSIGN_ORDERS = 'orders:assign',
  TRACK_ORDERS = 'orders:track',
  MANAGE_PAYMENTS = 'payments:manage',
  REPORT_INCIDENTS = 'incidents:report',
  MANAGE_INCIDENTS = 'incidents:manage',
  CAPTURE_DELIVERIES = 'deliveries:capture',
  VALIDATE_DELIVERIES = 'deliveries:validate',
  VIEW_REPORTS = 'reports:view',
  MANAGE_SETTINGS = 'settings:manage',
  VIEW_AUDIT = 'audit:view',
}

export const ROLE_PERMISSIONS: Record<ROLES, Permission[]> = {
  [ROLES.ADMIN]: Object.values(Permission),
  [ROLES.OPERATOR]: [
    Permission.VIEW_USERS,
    Permission.MANAGE_DRIVERS,
    Permission.MANAGE_VEHICLES,
    Permission.VIEW_ORDERS,
    Permission.MANAGE_ORDERS,
    Permission.ASSIGN_ORDERS,
    Permission.TRACK_ORDERS,
    Permission.MANAGE_INCIDENTS,
    Permission.VALIDATE_DELIVERIES,
    Permission.VIEW_REPORTS,
  ],
  [ROLES.DRIVER]: [
    Permission.VIEW_ORDERS,
    Permission.TRACK_ORDERS,
    Permission.REPORT_INCIDENTS,
    Permission.CAPTURE_DELIVERIES,
  ],
  [ROLES.CUSTOMER]: [
    Permission.CREATE_ORDERS,
    Permission.VIEW_ORDERS,
    Permission.TRACK_ORDERS,
    Permission.REPORT_INCIDENTS,
  ],
};

export function permissionsForRoles(roles: ROLES[]): Permission[] {
  const permissions = new Set<Permission>();

  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      permissions.add(permission);
    }
  }

  return [...permissions];
}
