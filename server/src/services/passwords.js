import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };

export function generatePassword() {
  return randomBytes(18).toString('base64url');
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64, OPTIONS);
  return `scrypt$${OPTIONS.N}$${OPTIONS.r}$${OPTIONS.p}$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, hash) {
  const [algorithm, n, r, p, salt, hex] = hash.split('$');
  if (algorithm !== 'scrypt' || Number(n) !== OPTIONS.N || Number(r) !== OPTIONS.r || Number(p) !== OPTIONS.p
    || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const key = await deriveKey(password, salt, 64, OPTIONS);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
