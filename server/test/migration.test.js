/**
 * T29 — migrate() upgrades a database created by the previous version.
 *
 * This needs a real file rather than :memory:, because the point is to open a database whose
 * on-disk schema predates the current one. It lives in its own file because db.js holds a
 * single connection per process and node:test gives each file its own process.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openDb, migrate, closeDb, getDb } from '../src/db.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'election-migrate-'));
const dbFile = path.join(tmpDir, 'old.db');

after(() => {
  try { closeDb(); } catch { /* already closed */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('T29  an older database gains the voting-window columns without losing its rows', () => {
  // ---- build a database with the schema as it was before the window existed ----
  const old = new DatabaseSync(dbFile);
  old.exec(`
    CREATE TABLE elections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'draft',
      created_at TEXT    NOT NULL
    );
  `);
  old.prepare('INSERT INTO elections (title, status, created_at) VALUES (?, ?, ?)')
    .run('Legacy Election 2025', 'closed', new Date().toISOString());
  const before = old.prepare('PRAGMA table_info(elections)').all().map((c) => c.name);
  old.close();

  assert.deepEqual(before, ['id', 'title', 'status', 'created_at'],
    'the fixture must not already have the new columns');

  // ---- open it through the application, which creates the missing tables and migrates ----
  openDb(dbFile);
  const added = migrate();
  assert.deepEqual(added.sort(), ['elections.closes_at', 'elections.opens_at'],
    'migrate() should report exactly the two columns it added');

  const cols = getDb().prepare('PRAGMA table_info(elections)').all().map((c) => c.name);
  assert.ok(cols.includes('opens_at') && cols.includes('closes_at'));

  // ---- the pre-existing row survives, and gets a usable window ----
  const rows = getDb().prepare('SELECT * FROM elections').all();
  assert.equal(rows.length, 1, 'the existing election must not be lost');
  assert.equal(rows[0].title, 'Legacy Election 2025');
  assert.ok(rows[0].opens_at, 'a migrated election must be given an opening time');
  assert.ok(rows[0].closes_at, 'a migrated election must be given a closing time');
  assert.ok(new Date(rows[0].closes_at).getTime() > new Date(rows[0].opens_at).getTime(),
    'the backfilled window must be ordered');

  // ---- running it again is a no-op ----
  assert.deepEqual(migrate(), [], 'migrate() must be idempotent');
});
