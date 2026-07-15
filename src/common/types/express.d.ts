import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

declare global {
  namespace Express {
    // Passport populates req.user with the value returned by JwtStrategy.validate().
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}
  }
}

export {};
