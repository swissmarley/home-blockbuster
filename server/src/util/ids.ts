import { createHash, randomBytes } from 'node:crypto';

/** Stable short id derived from a string (16 hex chars). */
export function hashId(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

/** Random id (12 hex chars) for user-created entities such as profiles and libraries. */
export function randomId(): string {
  return randomBytes(6).toString('hex');
}

export function randomSecret(): string {
  return randomBytes(32).toString('hex');
}
