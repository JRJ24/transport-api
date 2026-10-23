import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';

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
