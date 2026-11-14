import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Server port. */
export const PORT = Number(process.env.PORT || 3000);

/** Where the SQLite file lives. `:memory:` is used by the tests. */
export const DB_PATH =
  process.env.DB_PATH || path.join(here, '..', 'data', 'election.db');

/**
 * The key used for ballot encryption and for the voter hash.
 *
 * In a real deployment this comes from a secret manager and never from source. The
 * fallback exists so the project runs out of the box; it is deliberately obvious so
 * nobody mistakes it for a secret.
 */
export const APP_KEY = Buffer.from(
  process.env.APP_KEY_HEX ||
    crypto.createHash('sha256').update('dev-only-do-not-use-in-production').digest('hex'),
  'hex'
);

export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const OTP_MAX_ATTEMPTS = 5;

/** Built Vue client; served only if it exists. */
export const WEB_DIR = path.join(here, '..', '..', 'web', 'dist');

export const ROLES = ['voter', 'officer', 'admin', 'auditor'];
