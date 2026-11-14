import crypto from 'node:crypto';
import { APP_KEY } from './config.js';

const SCRYPT_KEYLEN = 64;

/** Hash a password with scrypt and a per-password salt. Format: scrypt$salt$hash. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** Constant-time password check. */
export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Opaque session token. 32 random bytes, stored server-side. */
export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Six-digit one-time password. */
export function newOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Short, human-transcribable receipt code. */
export function newReceiptCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/**
 * Keyed hash of (voterId, electionId).
 *
 * This is what makes the ballots table anonymous: it lets the system detect a duplicate
 * ballot for one voter in one election without storing the voter id next to the choice.
 */
export function voterHash(voterId, electionId) {
  return crypto
    .createHmac('sha256', APP_KEY)
    .update(`${electionId}:${voterId}`)
    .digest('hex');
}

/** AES-256-GCM. Returns base64 ciphertext, iv and auth tag. */
export function encryptChoice(plainObject) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', APP_KEY, iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(plainObject), 'utf8'),
    cipher.final(),
  ]);
  return {
    payload: payload.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Decrypt a ballot row. Throws if the tag does not verify (tampering). */
export function decryptChoice({ payload, iv, tag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', APP_KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(payload, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(out.toString('utf8'));
}

/** Constant-time string compare for OTP codes. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
