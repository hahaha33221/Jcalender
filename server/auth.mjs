/* 비밀번호(scrypt) · 세션 토큰 (원문은 기기에만, 서버에는 SHA-256 해시만) */
import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, LEN = 64;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFC'), salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, key] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(String(pw).normalize('NFC'), Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p });
  return crypto.timingSafeEqual(want, got);
}
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const tokenHash = t => crypto.createHash('sha256').update(String(t)).digest();
