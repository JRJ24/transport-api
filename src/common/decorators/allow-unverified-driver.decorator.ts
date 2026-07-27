import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_DRIVER_KEY = 'allowUnverifiedDriver';

/**
 * Allows a DRIVER account to access non-operational routes while its profile
 * is still pending approval.
 */
export const AllowUnverifiedDriver = () =>
  SetMetadata(ALLOW_UNVERIFIED_DRIVER_KEY, true);
