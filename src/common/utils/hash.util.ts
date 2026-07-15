import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';

/**
 * Valid bcrypt hash of a random value, compared against when the user does
 * not exist so login timing does not reveal whether an email is registered.
 */
export const DUMMY_PASSWORD_HASH: string = bcrypt.hashSync(
  'dummy-password-for-timing-equalization',
  12,
);

export function hashPassword(plain: string, rounds: number): Promise<string> {
  return bcrypt.hash(plain, rounds);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Fast one-way hash used for refresh tokens: the token itself is never
 * persisted, only its SHA-256 digest.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
