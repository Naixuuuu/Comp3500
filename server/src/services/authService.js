import { getDb, inTransaction } from '../db.js';
import { OTP_TTL_MS, SESSION_TTL_MS, OTP_MAX_ATTEMPTS } from '../config.js';
import {
  verifyPassword, newToken, newOtpCode, safeEqual,
} from '../crypto.js';
import * as audit from './auditService.js';
import { unauthorized, badRequest, forbidden } from '../errors.js';

const now = () => new Date().toISOString();

function publicUser(u) {
  return { voterId: u.voter_id, name: u.name, role: u.role };
}

/**
 * Step 1 of UC2: check the password and issue an OTP challenge.
 *
 * The response does not say whether the voter id exists — an enumeration oracle on a
 * voter register is itself a privacy leak.
 */
export function login(voterId, password) {
  if (!voterId || !password) throw badRequest('missing_fields', 'voterId and password are required');
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE voter_id = ?').get(String(voterId));

  if (!user) {
    audit.record(String(voterId), 'login.unknown_user', '');
    throw unauthorized('invalid_credentials', 'Voter ID or password is incorrect');
  }
  if (user.failed_attempts >= OTP_MAX_ATTEMPTS) {
    audit.record(user.voter_id, 'login.locked', '');
    throw forbidden('account_locked', 'This account is locked after repeated failures');
  }
  if (!verifyPassword(password, user.password_hash)) {
    db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?').run(user.id);
    audit.record(user.voter_id, 'login.bad_password',
      `attempt ${user.failed_attempts + 1} of ${OTP_MAX_ATTEMPTS}`);
    throw unauthorized('invalid_credentials', 'Voter ID or password is incorrect');
  }

  db.prepare('UPDATE users SET failed_attempts = 0 WHERE id = ?').run(user.id);

  const challengeId = newToken();
  const code = newOtpCode();
  db.prepare(
    'INSERT INTO otp_challenges (id, user_id, code, expires_at, consumed) VALUES (?, ?, ?, ?, 0)'
  ).run(challengeId, user.id, code, new Date(Date.now() + OTP_TTL_MS).toISOString());

  audit.record(user.voter_id, 'login.password_ok', 'otp challenge issued');

  // In a real deployment the code goes out through the OTP delivery service and is never
  // returned here. Returning it is what makes the demo runnable without that service.
  return { challengeId, devOtp: code, user: publicUser(user) };
}

/** Step 2 of UC2: check the OTP, mint a session token. */
export function verifyOtp(challengeId, code) {
  if (!challengeId || !code) throw badRequest('missing_fields', 'challengeId and code are required');
  const db = getDb();
  const ch = db.prepare('SELECT * FROM otp_challenges WHERE id = ?').get(String(challengeId));
  if (!ch) throw unauthorized('unknown_challenge', 'Challenge not found');
  if (ch.consumed) throw unauthorized('challenge_used', 'This code has already been used');
  if (new Date(ch.expires_at).getTime() < Date.now()) {
    throw unauthorized('challenge_expired', 'This code has expired');
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ch.user_id);

  if (!safeEqual(code, ch.code)) {
    db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?').run(user.id);
    db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(ch.id);
    audit.record(user.voter_id, 'login.bad_otp', '');
    throw unauthorized('invalid_otp', 'The one-time password is incorrect');
  }

  const token = inTransaction(() => {
    db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(ch.id);
    const t = newToken();
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(t, user.id, new Date(Date.now() + SESSION_TTL_MS).toISOString());
    return t;
  });

  audit.record(user.voter_id, 'login.success', 'session issued');
  return { token, user: publicUser(user) };
}

/** Resolve a bearer token to a user, or null. */
export function userForToken(token) {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
  ).get(String(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
    return null;
  }
  return row;
}

export function logout(token) {
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(String(token));
  db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
  if (row) {
    const u = db.prepare('SELECT voter_id FROM users WHERE id = ?').get(row.user_id);
    audit.record(u ? u.voter_id : 'unknown', 'logout', '');
  }
  return { ok: true };
}

export { publicUser, now };
