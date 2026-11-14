import { getDb } from '../db.js';

/**
 * Append an audit entry.
 *
 * There is deliberately no update and no delete function in this module: requirement F11
 * asks for an append-only record, and the cheapest way to get that is to not write the
 * other statements at all.
 */
export function record(actor, action, detail = '') {
  getDb()
    .prepare('INSERT INTO audit_log (actor, action, detail, created_at) VALUES (?, ?, ?, ?)')
    .run(actor, action, detail, new Date().toISOString());
}

export function list(limit = 200) {
  return getDb()
    .prepare('SELECT id, actor, action, detail, created_at FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(limit);
}
